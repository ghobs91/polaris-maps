import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, Alert } from 'react-native';
import { getDownloadedRegions } from '../../src/services/regions/regionRepository';
import {
  deleteRegionData,
  type DownloadProgress,
} from '../../src/services/regions/downloadService';
import { RegionCard, DownloadProgressBar } from '../../src/components/regions';
import { ErrorBoundary, LoadingSpinner } from '../../src/components/common';
import { colors, spacing, typography } from '../../src/constants/theme';
import type { Region } from '../../src/models/region';

export default function RegionsScreen() {
  const [regions, setRegions] = useState<Region[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadProgress] = useState<DownloadProgress | null>(null);

  const loadRegions = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getDownloadedRegions();
      setRegions(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRegions();
  }, [loadRegions]);

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
          Maps are powered by OpenFreeMap and available globally online. Downloaded regions are
          saved for offline use.
        </Text>

        {downloadProgress && <DownloadProgressBar progress={downloadProgress} />}

        <FlatList
          data={regions}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <RegionCard region={item} onDelete={handleDelete} />}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyText}>No regions saved for offline use</Text>
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
