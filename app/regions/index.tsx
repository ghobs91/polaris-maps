import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, Alert } from 'react-native';
import { getAllRegions } from '../../src/services/regions/regionRepository';
import {
  downloadRegion,
  deleteRegionData,
  type DownloadProgress,
} from '../../src/services/regions/downloadService';
import { seedCatalog } from '../../src/services/regions/catalogService';
import { RegionCard, DownloadProgressBar } from '../../src/components/regions';
import { ErrorBoundary, LoadingSpinner } from '../../src/components/common';
import { colors, spacing, typography } from '../../src/constants/theme';
import type { Region } from '../../src/models/region';

export default function RegionsScreen() {
  const [regions, setRegions] = useState<Region[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);

  const loadRegions = useCallback(async () => {
    setLoading(true);
    try {
      await seedCatalog();
      const data = await getAllRegions();
      setRegions(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRegions();
  }, [loadRegions]);

  const handleDownload = useCallback(
    async (region: Region) => {
      try {
        await downloadRegion(region, (progress) => {
          setDownloadProgress(progress);
          if (progress.stage === 'complete' || progress.stage === 'error') {
            setTimeout(() => {
              setDownloadProgress(null);
              loadRegions();
            }, 1000);
          }
        });
      } catch (e) {
        Alert.alert('Download Failed', (e as Error).message);
      }
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
        <Text style={styles.heading}>Available Regions</Text>

        {downloadProgress && <DownloadProgressBar progress={downloadProgress} />}

        <FlatList
          data={regions}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <RegionCard region={item} onDownload={handleDownload} onDelete={handleDelete} />
          )}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyText}>No regions available</Text>
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
  heading: { ...typography.h2, color: colors.text, marginBottom: spacing.md },
  list: { paddingBottom: spacing.xl },
  emptyText: { ...typography.body, color: colors.textSecondary },
});
