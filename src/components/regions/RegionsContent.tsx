import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert } from 'react-native';
import { getAllRegions, getRegionById } from '../../services/regions/regionRepository';
import { deleteRegionData } from '../../services/regions/downloadService';
import {
  startBackgroundDownload,
  cancelBackgroundDownload,
  ensureDownloadAppStateHandler,
} from '../../services/regions/downloadManager';
import { useRegionDownloadStore } from '../../stores/regionDownloadStore';
import { fetchAndSeedCatalog } from '../../services/regions/catalogService';
import { checkForRegionUpdates } from '../../services/regions/updateService';
import { upsertRegion } from '../../services/regions/regionRepository';
import { RegionCard, DownloadProgressBar, GeofabrikTreePicker } from '.';
import { LoadingSpinner } from '../common';
import { GEOFABRIK_TREE, type GeoNode, geoNodeToRegion } from '../../constants/geofabrikCatalog';
import { spacing, typography } from '../../constants/theme';
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

  const handleTreeDownload = useCallback(
    async (node: GeoNode) => {
      if (downloadingPath) return;
      const region = geoNodeToRegion(node);
      setDownloadingPath(node.path);
      try {
        await upsertRegion(region);
        await startBackgroundDownload(region);
        loadRegions();
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          Alert.alert('Download Failed', err instanceof Error ? err.message : 'Unknown error');
        }
      } finally {
        setDownloadingPath(null);
      }
    },
    [downloadingPath, loadRegions],
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

      <View style={styles.availableSection}>
        <Text style={styles.sectionTitle}>Available Regions</Text>
        <Text style={styles.description}>
          Maps are powered by OpenFreeMap and available globally online. Download regions to use
          them offline.
        </Text>
        <View style={styles.treeContainer}>
          <GeofabrikTreePicker
            nodes={GEOFABRIK_TREE}
            completedPaths={completedPaths}
            downloadingPath={downloadingPath}
            onDownload={handleTreeDownload}
          />
        </View>
      </View>
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
    availableSection: { flex: 1, minHeight: 0 },
    treeContainer: { flex: 1, minHeight: 0 },
  });
