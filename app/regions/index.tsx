import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, Alert } from 'react-native';
import { getAllRegions } from '../../src/services/regions/regionRepository';
import {
  downloadRegion,
  deleteRegionData,
  type DownloadProgress,
} from '../../src/services/regions/downloadService';
import { fetchAndSeedCatalog } from '../../src/services/regions/catalogService';
import { RegionCard, DownloadProgressBar } from '../../src/components/regions';
import { ErrorBoundary, LoadingSpinner } from '../../src/components/common';
import { colors, spacing, typography } from '../../src/constants/theme';
import type { Region } from '../../src/models/region';

export default function RegionsScreen() {
  const [regions, setRegions] = useState<Region[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeProgress, setActiveProgress] = useState<DownloadProgress | null>(null);
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());

  const loadRegions = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getAllRegions();
      setRegions(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRegions();
    // Seed available regions from catalog in background, then refresh the list
    fetchAndSeedCatalog()
      .then(() => loadRegions())
      .catch(() => {
        // Network may be unavailable — silently continue with local data
      });
  }, [loadRegions]);

  const handleDownload = useCallback(
    (region: Region) => {
      const controller = new AbortController();
      abortControllersRef.current.set(region.id, controller);

      downloadRegion(
        region,
        (progress) => {
          setActiveProgress(progress);
          if (progress.stage === 'complete' || progress.stage === 'error') {
            abortControllersRef.current.delete(region.id);
            loadRegions().then(() => setActiveProgress(null));
          }
        },
        controller.signal,
      ).catch((err: unknown) => {
        abortControllersRef.current.delete(region.id);
        if (err instanceof Error && err.name !== 'AbortError') {
          Alert.alert('Download Failed', err.message);
        }
        loadRegions().then(() => setActiveProgress(null));
      });
    },
    [loadRegions],
  );

  const handleCancel = useCallback(
    (region: Region) => {
      const controller = abortControllersRef.current.get(region.id);
      if (controller) {
        controller.abort();
        abortControllersRef.current.delete(region.id);
      }
      setActiveProgress(null);
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
    <ErrorBoundary>
      <View style={styles.container}>
        <Text style={styles.heading}>Offline Regions</Text>
        <Text style={styles.description}>
          Maps are powered by OpenFreeMap and available globally online. Download regions to use
          them offline.
        </Text>

        {activeProgress && <DownloadProgressBar progress={activeProgress} />}

        <FlatList
          data={regions}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <RegionCard
              region={item}
              onDownload={handleDownload}
              onCancel={handleCancel}
              onDelete={handleDelete}
            />
          )}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyText}>No offline regions available</Text>
            </View>
          }
        />
      </View>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.lg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  heading: { ...typography.h2, color: colors.text, marginBottom: spacing.xs },
  description: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.md },
  list: { paddingBottom: spacing.xl },
  emptyText: { ...typography.body, color: colors.textSecondary },
});
