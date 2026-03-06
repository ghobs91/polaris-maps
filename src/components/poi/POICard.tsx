import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { colors, spacing, typography, borderRadius } from '../../constants/theme';
import type { Place } from '../../models/poi';

interface POICardProps {
  place: Place;
  onPress?: (place: Place) => void;
}

export function POICard({ place, onPress }: POICardProps) {
  const categoryLabel = place.category.replace(/_/g, ' ');

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={() => onPress?.(place)}
      accessibilityRole="button"
      accessibilityLabel={`${place.name}, ${categoryLabel}`}
    >
      <View style={styles.header}>
        <Text style={styles.name} numberOfLines={1}>
          {place.name}
        </Text>
        {place.avgRating != null && (
          <View style={styles.ratingBadge}>
            <Text style={styles.ratingText}>{place.avgRating.toFixed(1)} ★</Text>
          </View>
        )}
      </View>

      <Text style={styles.category}>{categoryLabel}</Text>

      {place.addressStreet && (
        <Text style={styles.address} numberOfLines={1}>
          {[place.addressStreet, place.addressCity].filter(Boolean).join(', ')}
        </Text>
      )}

      <View style={styles.footer}>
        <View
          style={[
            styles.statusDot,
            place.status === 'open' ? styles.statusOpen : styles.statusClosed,
          ]}
        />
        <Text style={styles.statusText}>{place.status}</Text>
        {(place.reviewCount ?? 0) > 0 && (
          <Text style={styles.reviewCount}>
            {place.reviewCount} review{place.reviewCount !== 1 ? 's' : ''}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardPressed: {
    opacity: 0.7,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  name: {
    ...typography.subtitle,
    flex: 1,
    marginRight: spacing.sm,
    color: colors.text,
  },
  ratingBadge: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  ratingText: {
    ...typography.caption,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  category: {
    ...typography.caption,
    color: colors.textSecondary,
    textTransform: 'capitalize',
    marginBottom: spacing.xs,
  },
  address: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: spacing.xs,
  },
  statusOpen: {
    backgroundColor: colors.success,
  },
  statusClosed: {
    backgroundColor: colors.error,
  },
  statusText: {
    ...typography.caption,
    textTransform: 'capitalize',
    marginRight: spacing.md,
    color: colors.textSecondary,
  },
  reviewCount: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});
