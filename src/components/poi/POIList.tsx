import React, { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { POICard } from './POICard';
import { LoadingSpinner } from '../common';
import { colors, spacing, typography } from '../../constants/theme';
import type { Place } from '../../models/poi';

interface POIListProps {
  places: Place[];
  loading?: boolean;
  emptyMessage?: string;
  onPlacePress?: (place: Place) => void;
}

export function POIList({ places, loading, emptyMessage, onPlacePress }: POIListProps) {
  if (loading) {
    return (
      <View style={styles.center}>
        <LoadingSpinner size="large" />
      </View>
    );
  }

  if (places.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>{emptyMessage ?? 'No places found'}</Text>
      </View>
    );
  }

  const renderItem = useCallback(
    ({ item }: { item: Place }) => <POICard place={item} onPress={onPlacePress} />,
    [onPlacePress],
  );

  return (
    <FlashList
      data={places}
      keyExtractor={(item) => item.uuid}
      renderItem={renderItem}
      contentContainerStyle={styles.list}
      showsVerticalScrollIndicator={false}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    padding: spacing.md,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  emptyText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
