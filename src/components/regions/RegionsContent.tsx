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
import { orderPacks, filterPacks, downloadedRegions } from '../../services/regions/packOrder';
import { checkForRegionUpdates } from '../../services/regions/updateService';
import { RegionCard } from './RegionCard';
import { DownloadedRegionRow } from './DownloadedRegionRow';
import { DownloadProgressBar } from './DownloadProgressBar';
import { LoadingSpinner } from '../common';
import { spacing, typography, borderRadius } from '../../constants/theme';
import type { Region } from '../../models/region';
import { useTheme } from '../../contexts/ThemeContext';
import { useSettingsStore } from '../../stores/settingsStore';

/**
 * Region catalogue: a shelf of what is already on disk, then a search field over
 * every pack-backed area.
 *
 * Deliberately text-free otherwise — the screen is reached from Settings →
 * Download More Maps, so the user already knows what it is and the old heading,
 * auto-download status line and pack description only pushed the list down.
 */
export function RegionsContent() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  // Developer-only: pin a pack's origin so each can be verified on its own.
  const devMode = useSettingsStore((s) => s.devMode);
  const packSourcePreferences = useSettingsStore((s) => s.packSourcePreferences);
  const setPackSourcePreference = useSettingsStore((s) => s.setPackSourcePreference);
  const [regions, setRegions] = useState<Region[]>([]);
  const [staleRegionIds, setStaleRegionIds] = useState<Set<string>>(new Set());
  /** Filter for the pack list: 193 packs are unusable as a plain scroll. */
  const [packQuery, setPackQuery] = useState('');
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

  /**
   * Everything already on disk, packs and tile-only areas alike, shown on its
   * own shelf above the search so "what have I downloaded" (and deleting it)
   * does not require knowing the name to search for.
   */
  const downloaded = useMemo(() => downloadedRegions(regions), [regions]);

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

      {downloaded.length > 0 && (
        <View style={styles.downloadedSection}>
          <Text style={styles.sectionTitle}>Downloaded</Text>
          <ScrollView
            style={styles.downloadedScroll}
            contentContainerStyle={styles.downloadedList}
            nestedScrollEnabled
          >
            {downloaded.map((region) => (
              <DownloadedRegionRow key={region.id} region={region} onDelete={handleDelete} />
            ))}
          </ScrollView>
        </View>
      )}

      <View
        style={[
          styles.searchContainer,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <Ionicons name="search" size={18} color={colors.textSecondary} style={styles.searchIcon} />
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
        contentContainerStyle={styles.packList}
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {visiblePacks.map((region) => (
          <RegionCard
            key={region.id}
            region={region}
            onDownload={handleDownload}
            onCancel={handleCancel}
            onDelete={handleDelete}
            updateAvailable={staleRegionIds.has(region.id)}
            sourceChoice={devMode ? (packSourcePreferences[region.id] ?? 'auto') : undefined}
            onChangeSource={
              devMode ? (choice) => setPackSourcePreference(region.id, choice) : undefined
            }
            mirrorAdvertised={(region.assets ?? []).some(
              (asset) => (asset.mirrors ?? []).length > 0,
            )}
          />
        ))}
        {visiblePacks.length === 0 && (
          <Text style={styles.emptyText}>
            {packQuery.trim()
              ? `No pack matches “${packQuery.trim()}”.`
              : 'No offline packs available yet.'}
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background, padding: spacing.lg },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    section: {
      marginBottom: spacing.md,
    },
    sectionTitle: {
      ...typography.subtitle,
      color: colors.text,
      marginBottom: spacing.sm,
      marginTop: spacing.md,
    },
    /** Shelf of everything already on disk, above the search. */
    downloadedSection: {
      marginBottom: spacing.xs,
    },
    backgroundHint: {
      ...typography.body,
      color: colors.textSecondary,
      fontSize: 12,
      marginBottom: spacing.sm,
    },
    list: { paddingBottom: spacing.xl },
    emptyText: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.md },
    downloadedScroll: {
      maxHeight: 176,
      flexGrow: 0,
    },
    downloadedList: {
      paddingRight: spacing.xs,
    },
    /**
     * Packs are the primary path and now the whole screen, so the list fills
     * whatever space the shelf does not use.
     */
    packScroll: {
      flex: 1,
      minHeight: 0,
    },
    packList: { paddingBottom: spacing.md },
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
  });
