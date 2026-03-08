import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, Alert } from 'react-native';
import { getDownloadedRegions } from '../../src/services/regions/regionRepository';
import { deleteRegionData } from '../../src/services/regions/downloadService';
import { RegionCard } from '../../src/components/regions';
import { ErrorBoundary, LoadingSpinner } from '../../src/components/common';
import { colors, spacing, typography } from '../../src/constants/theme';
import type { Region } from '../../src/models/region';

export default function OfflineRegionsScreen() {
  const [regions, setRegions] = useState<Region[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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
              setDeletingId(region.id);
              deleteRegionData(region.id)
                .then(() => loadRegions())
                .catch((err) =>
                  Alert.alert('Delete Failed', err instanceof Error ? err.message : 'Unknown error'),
                )
                .finally(() => setDeletingId(null));
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

  const totalSizeMb =
    regions.reduce((sum, r) => {
      return (
        sum + ((r.tilesSizeBytes ?? 0) + (r.routingSizeBytes ?? 0) + (r.geocodingSizeBytes ?? 0))
      );
    }, 0) /
    (1024 * 1024);

  return (
    <ErrorBoundary>
      <View style={styles.container}>
        <Text style={styles.heading}>Downloaded Regions</Text>
        <Text style={styles.storageInfo}>Total: {Math.round(totalSizeMb)} MB</Text>

        <FlatList
          data={regions}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <RegionCard
              region={item}
              onDelete={deletingId === item.id ? undefined : handleDelete}
            />
          )}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyText}>No regions downloaded yet</Text>
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
  storageInfo: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.md },
  list: { paddingBottom: spacing.xl },
  emptyText: { ...typography.body, color: colors.textSecondary },
});
