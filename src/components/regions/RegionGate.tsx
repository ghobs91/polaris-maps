import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, Alert } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { colors, darkColors, spacing, typography, borderRadius } from '../../constants/theme';
import { DownloadProgressBar } from './DownloadProgressBar';
import { LoadingSpinner } from '../common';
import {
  GEOFABRIK_TREE,
  type GeoNode,
  geoNodeToRegion,
  findDeepestNodeContainingPoint,
} from '../../constants/geofabrikCatalog';
import {
  upsertRegion,
  getDownloadedRegions,
  getAllRegions,
} from '../../services/regions/regionRepository';
import { fetchAndSeedCatalog } from '../../services/regions/catalogService';
import {
  packRegionForNodeId,
  packsIntersectingBounds,
  pickNearestPackRegion,
} from '../../services/regions/nearestPackRegion';
import { planOfflineTileDownload } from '../../services/regions/tileDownloadPlan';
import type { Region } from '../../models/region';
import { downloadRegion, type DownloadProgress } from '../../services/regions/downloadService';
import {
  seedRegion,
  unseedRegion,
  getHyperdriveStatus,
} from '../../services/sync/hyperdriveBridge';
import * as FileSystem from 'expo-file-system/legacy';
import { GeofabrikTreePicker } from './GeofabrikTreePicker';

interface RegionGateProps {
  /** True while location/DB check is still running — shows a spinner. */
  checking: boolean;
  userLat?: number;
  userLng?: number;
  /** Called when the user either completes a download or taps "Skip for Now". */
  onDismiss: () => void;
}

export function RegionGate({ checking, userLat, userLng, onDismiss }: RegionGateProps) {
  const { isDark } = useTheme();
  const c = isDark ? darkColors : colors;

  const [downloading, setDownloading] = useState<string | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [completedPaths, setCompletedPaths] = useState<Set<string>>(new Set());
  const [seedingPaths, setSeedingPaths] = useState<Set<string>>(new Set());
  /**
   * The pack-backed region to offer above the Geofabrik tree.
   *
   * The tree is states and countries, none of which have a pack, so they
   * download as OpenFreeMap tiles and are capped at 50 MB — a large state fails
   * every time. The packs have no such cap, so the nearest one is offered first
   * and the tree becomes the "somewhere else" option.
   */
  const [suggestedPack, setSuggestedPack] = useState<Region | null>(null);
  const [allRegions, setAllRegions] = useState<Region[]>([]);
  const [packDownloading, setPackDownloading] = useState(false);
  const [packDownloaded, setPackDownloaded] = useState(false);
  const [seedPeerCounts, setSeedPeerCounts] = useState<Map<string, number>>(new Map());
  const abortControllerRef = useRef<AbortController | null>(null);

  const suggestedNode = useMemo(
    () =>
      userLat != null && userLng != null
        ? findDeepestNodeContainingPoint(GEOFABRIK_TREE, userLat, userLng)
        : null,
    [userLat, userLng],
  );

  // Build a map from region ID (path with / replaced by -) back to the original path
  const idToPathMap = useMemo(() => {
    const map = new Map<string, string>();
    function walk(nodes: GeoNode[]) {
      for (const node of nodes) {
        map.set(node.path.replace(/\//g, '-'), node.path);
        if (node.children) walk(node.children);
      }
    }
    walk(GEOFABRIK_TREE);
    return map;
  }, []);

  // Load already-downloaded regions from DB so the gate reflects persisted state
  useEffect(() => {
    getDownloadedRegions().then((regions) => {
      const paths = new Set<string>();
      for (const region of regions) {
        const path = idToPathMap.get(region.id);
        if (path) paths.add(path);
      }
      if (paths.size > 0) setCompletedPaths(paths);
    });
  }, [idToPathMap]);

  const handleDownloadPack = useCallback(
    async (region: Region) => {
      if (downloading || packDownloading) return;
      const controller = new AbortController();
      abortControllerRef.current = controller;
      setPackDownloading(true);
      setProgress(null);
      try {
        await upsertRegion(region);
        await downloadRegion(region, (p) => setProgress(p), controller.signal);
        if (!controller.signal.aborted) setPackDownloaded(true);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          Alert.alert('Download Failed', err instanceof Error ? err.message : 'Unknown error');
        }
      } finally {
        abortControllerRef.current = null;
        setPackDownloading(false);
      }
    },
    [downloading, packDownloading],
  );

  /**
   * Download a tree node: its pack when the catalog has one (the pack catalog
   * is generated from this tree, so ids match), else tiles — refused up front
   * when the plan had to reduce detail, since the byte cap would abort it
   * halfway through.
   */
  const handleDownload = useCallback(
    async (node: GeoNode) => {
      if (downloading) return;
      const nodeRegion = geoNodeToRegion(node);
      const pack = packRegionForNodeId(allRegions, nodeRegion.id);
      if (pack) {
        await handleDownloadPack(pack);
        return;
      }

      const plan = planOfflineTileDownload(nodeRegion.bounds);
      if (plan.reduced) {
        const covering = packsIntersectingBounds(allRegions, nodeRegion.bounds);
        const suggestion = covering[0]
          ? `The ${covering[0].name} pack covers part of this area — use the button above.`
          : 'Try a smaller area.';
        Alert.alert(
          'Area Too Large',
          `${node.name} needs more detail than OpenFreeMap's 50 MB offline limit allows. ${suggestion}`,
        );
        return;
      }

      const region = nodeRegion;
      const controller = new AbortController();
      abortControllerRef.current = controller;
      setDownloading(node.path);
      setProgress(null);
      try {
        await upsertRegion(region);
        await downloadRegion(region, (p) => setProgress(p), controller.signal);
        if (!controller.signal.aborted) {
          setCompletedPaths((prev) => new Set([...prev, node.path]));
          setSeedingPaths((prev) => new Set([...prev, node.path]));
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          Alert.alert('Download Failed', err instanceof Error ? err.message : 'Unknown error');
        }
      } finally {
        abortControllerRef.current = null;
        setDownloading(null);
      }
    },
    [downloading],
  );

  /**
   * Offer the nearest pack. Seeding first is what makes this work on a fresh
   * install: the region table starts empty, so there would be nothing to
   * suggest. The cached manifest seeds instantly and offline.
   */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await fetchAndSeedCatalog().catch(() => undefined);
        const all = await getAllRegions();
        if (cancelled) return;
        setAllRegions(all);
        const pack = pickNearestPackRegion(all, userLat, userLng);
        setSuggestedPack(pack);
        if (pack) {
          const downloaded = await getDownloadedRegions().catch(() => [] as Region[]);
          if (!cancelled) setPackDownloaded(downloaded.some((r) => r.id === pack.id));
        }
      } catch {
        // No suggestion is survivable: the tree below still works.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userLat, userLng]);

  /**
   * Download a pack-backed region. Unlike the tree handler this keeps the
   * region's `assets`, which is what routes the download to the pack instead of
   * the capped per-tile path.
   */
  const handleCancel = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const handleToggleSeed = useCallback(async (node: GeoNode, seed: boolean) => {
    const region = geoNodeToRegion(node);
    const dir = `${FileSystem.documentDirectory}regions/${region.id}/`;
    try {
      if (seed) {
        await seedRegion(region.id, dir);
        setSeedingPaths((prev) => new Set([...prev, node.path]));
      } else {
        await unseedRegion(region.id);
        setSeedingPaths((prev) => {
          const next = new Set(prev);
          next.delete(node.path);
          return next;
        });
      }
    } catch {
      // Silently ignore — toggle will reflect actual state on next poll
    }
  }, []);

  // Poll hyperdrive status to update peer counts & seeding state
  useEffect(() => {
    if (completedPaths.size === 0) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const status = await getHyperdriveStatus();
        if (cancelled) return;
        const nextSeeding = new Set<string>();
        const nextCounts = new Map<string, number>();
        for (const drive of status.drives) {
          // Find the path for this regionId
          for (const path of completedPaths) {
            // Only need path for region.id derivation
            if (path.replace(/\//g, '-') === drive.regionId) {
              nextSeeding.add(path);
              nextCounts.set(path, drive.peers);
              break;
            }
          }
        }
        setSeedingPaths(nextSeeding);
        setSeedPeerCounts(nextCounts);
      } catch {
        // Ignore polling errors
      }
    };
    poll();
    const interval = setInterval(poll, 10_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [completedPaths]);

  if (checking) {
    return (
      <View style={[styles.overlay, { backgroundColor: c.background }]}>
        <LoadingSpinner size="large" />
      </View>
    );
  }

  return (
    <SafeAreaView style={[styles.overlay, { backgroundColor: c.background }]}>
      <View style={styles.content}>
        <Text style={[styles.title, { color: c.text }]}>Download Your Region</Text>
        <Text style={[styles.body, { color: c.textSecondary }]}>
          Polaris Maps works best with offline data for your area. Download a region to unlock
          routing, local search, and offline maps.
        </Text>

        {suggestedNode && (
          <Text style={[styles.hint, { color: c.primary }]}>
            A region near your current location is highlighted below.
          </Text>
        )}

        {progress && (downloading || packDownloading) && (
          <View style={styles.progressWrapper}>
            <DownloadProgressBar progress={progress} />
            <TouchableOpacity style={styles.cancelBtn} onPress={handleCancel} activeOpacity={0.7}>
              <Text style={[styles.cancelText, { color: c.textSecondary }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}

        {suggestedPack && (
          <View style={[styles.packCard, { borderColor: c.primary }]}>
            <Text style={[styles.packEyebrow, { color: c.primary }]}>
              {userLat != null ? 'YOUR AREA' : 'SUGGESTED'}
            </Text>
            <Text style={[styles.packName, { color: c.text }]}>{suggestedPack.name}</Text>
            <Text style={[styles.packNote, { color: c.textSecondary }]}>
              Offline map pack — routing, local search and offline maps.
            </Text>
            <TouchableOpacity
              style={[
                styles.packBtn,
                {
                  backgroundColor: packDownloaded ? c.surface : c.primary,
                  opacity: downloading || packDownloading ? 0.6 : 1,
                },
              ]}
              onPress={() => void handleDownloadPack(suggestedPack)}
              disabled={packDownloaded || !!downloading || packDownloading}
              activeOpacity={0.85}
            >
              <Text
                style={[styles.packBtnText, { color: packDownloaded ? c.textSecondary : '#fff' }]}
              >
                {packDownloaded ? 'Downloaded' : packDownloading ? 'Downloading…' : 'Download'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        <Text style={[styles.treeHint, { color: c.textSecondary }]}>
          {suggestedPack
            ? 'Or pick a different area. Areas without a pack download as map tiles, and large ones exceed the 50 MB per-download limit.'
            : 'Pick an area to download.'}
        </Text>

        <GeofabrikTreePicker
          nodes={GEOFABRIK_TREE}
          userLat={userLat}
          userLng={userLng}
          suggestedPath={suggestedNode?.path ?? null}
          downloadingPath={downloading}
          completedPaths={completedPaths}
          onDownload={handleDownload}
          seedingPaths={seedingPaths}
          seedPeerCounts={seedPeerCounts}
          onToggleSeed={handleToggleSeed}
        />

        {completedPaths.size > 0 && (
          <TouchableOpacity
            style={[styles.openBtn, { backgroundColor: c.primary }]}
            onPress={onDismiss}
            activeOpacity={0.85}
          >
            <Text style={styles.openBtnText}>Open App</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity style={styles.skipBtn} onPress={onDismiss} activeOpacity={0.7}>
          <Text style={[styles.skipText, { color: c.textSecondary }]}>Skip for Now</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 999,
  },
  packCard: {
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  packEyebrow: {
    ...typography.caption,
    letterSpacing: 1,
    marginBottom: spacing.xs,
  },
  packName: {
    ...typography.h3,
    marginBottom: spacing.xs,
  },
  packNote: {
    ...typography.caption,
    marginBottom: spacing.sm,
  },
  packBtn: {
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  packBtnText: {
    ...typography.body,
    fontWeight: '600',
  },
  treeHint: {
    ...typography.caption,
    marginBottom: spacing.sm,
  },
  content: {
    flex: 1,
    padding: spacing.lg,
  },
  title: {
    ...typography.h1,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  body: {
    ...typography.body,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  hint: {
    ...typography.caption,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  progressWrapper: {
    marginBottom: spacing.sm,
  },
  cancelBtn: {
    alignSelf: 'flex-end',
    paddingVertical: 2,
    paddingHorizontal: spacing.xs,
    marginTop: 2,
  },
  cancelText: {
    ...typography.caption,
  },
  treeWrapper: {
    flex: 1,
    marginTop: spacing.sm,
  },
  openBtn: {
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  openBtnText: {
    ...typography.body,
    color: colors.white,
    fontWeight: '700',
  },
  skipBtn: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  skipText: {
    ...typography.caption,
  },
});
