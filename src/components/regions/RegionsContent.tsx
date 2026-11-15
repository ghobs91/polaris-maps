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
import { orderPacks, filterPacks } from '../../services/regions/packOrder';
import {
  getLastAutoDownloadDecision,
  describeAutoDownloadForUser,
} from '../../services/regions/autoRegionDownloadCoordinator';
import { checkForRegionUpdates } from '../../services/regions/updateService';
import { RegionCard } from './RegionCard';
import { DownloadProgressBar } from './DownloadProgressBar';
import { LoadingSpinner } from '../common';
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
    return `Auto-download: ${describeAutoDownloadForUser(decision)} (${when})`;
  }, [regions]);

  /**
   * Every pack-backed area, whatever its state.
   *
   * The list used to exclude downloading and downloaded packs, which made the
   * search lie: typing "new york" while the New York pack was mid-download
   * returned zero results — the pack the user cares about most. The badge on
   * each card carries the state instead.
   */
  const packRegions = useMemo(
    () => orderPacks(regions.filter((r) => (r.assets?.length ?? 0) > 0)),
    [regions],
  );

  const visiblePacks = useMemo(() => filterPacks(packRegions, packQuery), [packRegions, packQuery]);

  /** Tile-only areas that finished downloading (no pack exists for them). */
  const downloadedTileRegions = useMemo(
    () => regions.filter((r) => (r.assets?.length ?? 0) === 0 && r.downloadStatus === 'complete'),
    [regions],
  );

  const [loading, setLoading] = useState(true);
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

  const handleCancel = useCallback(
    (region: Region) => {
      cancelBackgroundDownload(region.id);
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

      {packRegions.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Offline Packs</Text>
          <Text style={styles.description}>
            {packQuery.trim()
              ? `${visiblePacks.length} of ${packRegions.length} match “${packQuery.trim()}”.`
              : `${packRegions.length} areas, each with offline maps, routing and search. Downloaded packs are marked and stay in this list.`}
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

      {downloadedTileRegions.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Downloaded Tile Areas</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.downloadedScroll}
          >
            {downloadedTileRegions.map((region) => (
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
      ...typography.caption,
      fontSize: 11,
      color: colors.textSecondary,
      opacity: 0.8,
      marginTop: 8,
    },
    availableSection: { flex: 1, minHeight: 0 },
    treeContainer: { flex: 1, minHeight: 0 },
  });
