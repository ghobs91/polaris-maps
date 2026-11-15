import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, TextInput, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getAllRegions, getRegionById } from '../../services/regions/regionRepository';
import { deleteRegionData } from '../../services/regions/downloadService';
import {
  startBackgroundDownload,
  cancelBackgroundDownload,
  ensureDownloadAppStateHandler,
} from '../../services/regions/downloadManager';
import { useRegionDownloadStore } from '../../stores/regionDownloadStore';
import { fetchAndSeedCatalog } from '../../services/regions/catalogService';
import {
  packRegionForNodeId,
  packsIntersectingBounds,
} from '../../services/regions/nearestPackRegion';
import { planOfflineTileDownload } from '../../services/regions/tileDownloadPlan';
import { uncoveredTree, flattenTree } from '../../services/regions/uncoveredTree';
import {
  getLastAutoDownloadDecision,
  describeAutoDownloadForUser,
} from '../../services/regions/autoRegionDownloadCoordinator';
import { checkForRegionUpdates } from '../../services/regions/updateService';
import { upsertRegion } from '../../services/regions/regionRepository';
import { RegionCard, DownloadProgressBar, GeofabrikTreePicker } from '.';
import { LoadingSpinner } from '../common';
import { GEOFABRIK_TREE, type GeoNode, geoNodeToRegion } from '../../constants/geofabrikCatalog';
import { spacing, typography, borderRadius } from '../../constants/theme';
import type { Region } from '../../models/region';
import { useTheme } from '../../contexts/ThemeContext';

interface RegionsContentProps {
  showHeading?: boolean;
}

export function RegionsContent({ showHeading = true }: RegionsContentProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [staleRegionIds, setStaleRegionIds] = useState<Set<string>>(new Set());
  /** Filter for the pack list: 193 packs are unusable as a plain scroll. */
  const [packQuery, setPackQuery] = useState('');
  /**
   * Catalog regions with a pack that are not yet downloaded.
   *
   * These were previously never rendered — "Available Regions" showed only the
   * Geofabrik tree, whose entries have no pack and are capped at OpenFreeMap's
   * 50 MB offline limit. The packs, which have no such cap, were unreachable
   * from this screen.
   */
  /**
   * Why the background downloader last did or did not run, or null when it has
   * never evaluated (e.g. it is disabled). Surfaces reasons that were
   * previously only in a log no screen reads — 'no-region', 'metered',
   * 'size-unknown' — so a silent skip can be told apart from a broken one.
   */
  const autoDownloadLine = useMemo(() => {
    const decision = getLastAutoDownloadDecision();
    if (!decision) return null;
    const ageMin = Math.round((Date.now() - decision.at) / 60_000);
    const when = ageMin <= 0 ? 'just now' : `${ageMin}m ago`;
    // Rendered the raw enum and the region id before (`skip auto-download:
    // metered (us-ny-new-york)`), which told the user nothing they could act on.
    return `Automatic download — ${describeAutoDownloadForUser(decision)} (${when})`;
  }, [regions]);

  const availablePacks = useMemo(
    () =>
      regions.filter(
        (region) =>
          (region.assets?.length ?? 0) > 0 &&
          region.downloadStatus !== 'complete' &&
          region.downloadStatus !== 'downloading',
      ),
    [regions],
  );

  /**
   * Every area a pack covers, downloaded or not.
   *
   * Downloaded ones count too: their tree entry is just as redundant, and the
   * pack list above only shows what is not yet downloaded.
   */
  const packIds = useMemo(
    () => new Set(regions.filter((r) => (r.assets?.length ?? 0) > 0).map((r) => r.id)),
    [regions],
  );

  const visiblePacks = useMemo(() => {
    const needle = packQuery.trim().toLowerCase();
    if (!needle) return availablePacks;
    return availablePacks.filter(
      (region) =>
        region.name.toLowerCase().includes(needle) || region.id.toLowerCase().includes(needle),
    );
  }, [availablePacks, packQuery]);

  /**
   * The Geofabrik tree with pack-covered areas removed.
   *
   * The tree downloads raw OpenFreeMap tiles, capped at 50 MB per download.
   * Listing an area there when a pack already covers it offers the worse of two
   * downloads for the same place, so the tree is now only the fallback: places
   * with no pack, for whatever reason.
   */
  const uncoveredNodes = useMemo(() => uncoveredTree(GEOFABRIK_TREE, packIds), [packIds]);
  const uncoveredCount = useMemo(
    () => flattenTree(uncoveredNodes).filter((node) => !node.children?.length).length,
    [uncoveredNodes],
  );
  const [loading, setLoading] = useState(true);
  const [downloadingPath, setDownloadingPath] = useState<string | null>(null);
  // Global progress — survives screen unmount + app backgrounding.
  const progressByRegion = useRegionDownloadStore((s) => s.progressByRegion);
  const activeIds = useRegionDownloadStore((s) => s.activeIds);

  const loadRegions = useCallback(async () => {
    setLoading(true);
    try {
      const [data, stale] = await Promise.all([
        getAllRegions(),
        checkForRegionUpdates().catch(() => [] as Region[]),
      ]);
      setRegions(data);
      setStaleRegionIds(new Set(stale.map((r) => r.id)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRegions();
    fetchAndSeedCatalog()
      .then(() => loadRegions())
      .catch(() => {
        // Network may be unavailable — silently continue with local data
      });
    // Resume interrupted downloads on foreground (e.g. app was minimized).
    ensureDownloadAppStateHandler((id) => getRegionById(id), loadRegions);
  }, [loadRegions]);

  // Refresh the list whenever all background downloads finish.
  const prevActiveCount = React.useRef(activeIds.length);
  useEffect(() => {
    if (prevActiveCount.current > 0 && activeIds.length === 0) {
      void loadRegions();
    }
    prevActiveCount.current = activeIds.length;
  }, [activeIds.length, loadRegions]);

  const handleDownload = useCallback(
    (region: Region) => {
      // Fire-and-forget into the global manager: navigating away or
      // minimizing no longer cancels — progress lives in the store.
      void startBackgroundDownload(region).then(
        () => loadRegions(),
        (err: unknown) => {
          if (err instanceof Error && err.name !== 'AbortError') {
            Alert.alert('Download Failed', err.message);
          }
          loadRegions();
        },
      );
    },
    [loadRegions],
  );

  /**
   * Download a tree node: its pack when the catalog has one, else tiles.
   *
   * This was previously unconditional tiles — which is why tapping an area
   * always used the capped method even when a pack covered it. The pack catalog
   * is generated from the same tree, so ids line up and the lookup is exact.
   *
   * When there is no pack and the tile plan had to reduce detail to fit the
   * 3,000-tile budget, the download is refused *before* starting: the byte cap
   * would abort it halfway through, after 50 MB of the user's bandwidth.
   */
  const handleTreeDownload = useCallback(
    async (node: GeoNode) => {
      if (downloadingPath) return;
      const nodeRegion = geoNodeToRegion(node);
      const pack = packRegionForNodeId(regions, nodeRegion.id);
      if (pack) {
        await handleDownload(pack);
        return;
      }

      const plan = planOfflineTileDownload(nodeRegion.bounds);
      if (plan.reduced) {
        const covering = packsIntersectingBounds(regions, nodeRegion.bounds);
        const suggestion = covering[0]
          ? `The ${covering[0].name} pack covers part of this area — download that instead.`
          : 'Try a smaller area.';
        Alert.alert(
          'Area Too Large',
          `${node.name} needs more detail than OpenFreeMap's 50 MB offline limit allows. ${suggestion}`,
        );
        return;
      }

      setDownloadingPath(node.path);
      try {
        await upsertRegion(nodeRegion);
        await startBackgroundDownload(nodeRegion);
        loadRegions();
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          Alert.alert('Download Failed', err instanceof Error ? err.message : 'Unknown error');
        }
      } finally {
        setDownloadingPath(null);
      }
    },
    [downloadingPath, loadRegions, regions, handleDownload],
  );

  const handleCancel = useCallback(
    (region: Region) => {
      cancelBackgroundDownload(region.id);
      setDownloadingPath(null);
      loadRegions();
    },
    [loadRegions],
  );

  const handleDelete = useCallback(
    (region: Region) => {
      Alert.alert(
        'Delete Region',
        `Delete all offline data for ${region.name}? You'll need to re-download to use it offline.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => {
              deleteRegionData(region.id)
                .then(() => loadRegions())
                .catch((err) =>
                  Alert.alert(
                    'Delete Failed',
                    err instanceof Error ? err.message : 'Unknown error',
                  ),
                );
            },
          },
        ],
      );
    },
    [loadRegions],
  );

  const downloadedRegions = useMemo(
    () => regions.filter((r) => r.downloadStatus === 'complete'),
    [regions],
  );

  const completedPaths = useMemo(() => {
    const paths = new Set<string>();
    for (const region of regions) {
      if (region.downloadStatus === 'complete') {
        // Region IDs use - as separator but tree paths use /
        paths.add(region.id.replace(/-/g, '/'));
      }
    }
    return paths;
  }, [regions]);

  if (loading) {
    return (
      <View style={styles.center}>
        <LoadingSpinner size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {showHeading && <Text style={styles.heading}>Offline Regions</Text>}

      {activeIds.map((id) =>
        progressByRegion[id] ? (
          <DownloadProgressBar key={id} progress={progressByRegion[id]} />
        ) : null,
      )}
      {activeIds.length > 0 && (
        <Text style={styles.backgroundHint}>
          Downloading in background — you can switch tabs or minimize the app.
        </Text>
      )}

      {autoDownloadLine && <Text style={styles.autoDownloadHint}>{autoDownloadLine}</Text>}

      {availablePacks.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Available Packs</Text>
          <Text style={styles.description}>
            {packQuery.trim()
              ? `${visiblePacks.length} of ${availablePacks.length} packs match “${packQuery.trim()}”.`
              : `${availablePacks.length} full offline packs — maps, routing, search and transit — with no per-download size limit. Prefer these: a pack covers its whole area, so the areas it covers are not listed again below.`}
          </Text>
          <View
            style={[
              styles.searchContainer,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Ionicons
              name="search"
              size={18}
              color={colors.textSecondary}
              style={styles.searchIcon}
            />
            <TextInput
              style={[styles.searchInput, { color: colors.text }]}
              value={packQuery}
              onChangeText={setPackQuery}
              placeholder="Search packs..."
              placeholderTextColor={colors.textSecondary}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              accessibilityLabel="Search packs"
            />
            {packQuery.length > 0 && (
              <Pressable
                onPress={() => setPackQuery('')}
                accessibilityRole="button"
                accessibilityLabel="Clear pack search"
                hitSlop={8}
              >
                <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
              </Pressable>
            )}
          </View>
          <ScrollView
            style={styles.packScroll}
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
          >
            {visiblePacks.map((region) => (
              <RegionCard
                key={region.id}
                region={region}
                onDownload={handleDownload}
                onCancel={handleCancel}
                onDelete={handleDelete}
                updateAvailable={staleRegionIds.has(region.id)}
              />
            ))}
            {visiblePacks.length === 0 && (
              <Text style={styles.emptyText}>No pack matches “{packQuery.trim()}”.</Text>
            )}
          </ScrollView>
        </View>
      )}

      {downloadedRegions.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Downloaded Regions</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.downloadedScroll}
          >
            {downloadedRegions.map((region) => (
              <RegionCard
                key={region.id}
                region={region}
                onDownload={handleDownload}
                onCancel={handleCancel}
                onDelete={handleDelete}
                updateAvailable={staleRegionIds.has(region.id)}
              />
            ))}
          </ScrollView>
        </View>
      )}

      {uncoveredNodes.length > 0 && (
        <View style={styles.availableSection}>
          <Text style={styles.sectionTitle}>No Pack Available</Text>
          <Text style={styles.description}>
            {uncoveredCount} areas have no pack yet — entire large countries, and places the pack
            build has not reached. These download as map tiles from OpenFreeMap, which is capped at
            50 MB per download, so the largest of them will fail.
          </Text>
          <View style={styles.treeContainer}>
            <GeofabrikTreePicker
              nodes={uncoveredNodes}
              completedPaths={completedPaths}
              downloadingPath={downloadingPath}
              onDownload={handleTreeDownload}
            />
          </View>
        </View>
      )}
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background, padding: spacing.lg },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    heading: { ...typography.h2, color: colors.text, marginBottom: spacing.xs },
    section: {
      marginBottom: spacing.md,
    },
    sectionTitle: {
      ...typography.subtitle,
      color: colors.text,
      marginBottom: spacing.sm,
      marginTop: spacing.md,
    },
    description: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.md },
    backgroundHint: {
      ...typography.body,
      color: colors.textSecondary,
      fontSize: 12,
      marginBottom: spacing.sm,
    },
    list: { paddingBottom: spacing.xl },
    emptyText: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.md },
    downloadedScroll: {
      maxHeight: 200,
    },
    /**
     * Packs are the primary path, so they get a tall vertical list of full-width
     * cards rather than a horizontal strip of clipped ones. Bounded so the
     * fallback tree below keeps usable space.
     */
    packScroll: {
      maxHeight: 380,
    },
    searchContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: spacing.sm,
      paddingHorizontal: spacing.sm,
      borderRadius: borderRadius.lg,
      borderWidth: 1,
    },
    searchIcon: {
      marginLeft: spacing.xs,
    },
    searchInput: {
      ...typography.body,
      flex: 1,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.sm + 2,
    },
    autoDownloadHint: {
      fontSize: 11,
      opacity: 0.6,
      marginTop: 8,
    },
    availableSection: { flex: 1, minHeight: 0 },
    treeContainer: { flex: 1, minHeight: 0 },
  });
