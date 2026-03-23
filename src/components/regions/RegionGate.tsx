import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  Alert,
  useColorScheme,
} from 'react-native';
import { colors, darkColors, spacing, typography, borderRadius } from '../../constants/theme';
import { DownloadProgressBar } from './DownloadProgressBar';
import { LoadingSpinner } from '../common';
import {
  GEOFABRIK_TREE,
  type GeoNode,
  geoNodeToRegion,
  findDeepestNodeContainingPoint,
} from '../../constants/geofabrikCatalog';
import { upsertRegion } from '../../services/regions/regionRepository';
import { downloadRegion, type DownloadProgress } from '../../services/regions/downloadService';
import {
  seedRegion,
  unseedRegion,
  getHyperdriveStatus,
} from '../../services/sync/hyperdriveBridge';
import * as FileSystem from 'expo-file-system';
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
  const isDark = useColorScheme() === 'dark';
  const c = isDark ? darkColors : colors;

  const [downloading, setDownloading] = useState<string | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [completedPaths, setCompletedPaths] = useState<Set<string>>(new Set());
  const [seedingPaths, setSeedingPaths] = useState<Set<string>>(new Set());
  const [seedPeerCounts, setSeedPeerCounts] = useState<Map<string, number>>(new Map());
  const abortControllerRef = useRef<AbortController | null>(null);

  const suggestedNode = useMemo(
    () =>
      userLat != null && userLng != null
        ? findDeepestNodeContainingPoint(GEOFABRIK_TREE, userLat, userLng)
        : null,
    [userLat, userLng],
  );

  const handleDownload = useCallback(
    async (node: GeoNode) => {
      if (downloading) return;
      const region = geoNodeToRegion(node);
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

        {progress && downloading && (
          <View style={styles.progressWrapper}>
            <DownloadProgressBar progress={progress} />
            <TouchableOpacity style={styles.cancelBtn} onPress={handleCancel} activeOpacity={0.7}>
              <Text style={[styles.cancelText, { color: c.textSecondary }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}

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
    ...StyleSheet.absoluteFillObject,
    zIndex: 999,
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
