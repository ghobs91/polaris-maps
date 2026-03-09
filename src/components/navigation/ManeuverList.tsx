import React from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { colors, spacing, typography, borderRadius } from '../../constants/theme';
import { formatDistance } from '../../utils/units';
import type { ValhallaManeuver } from '../../models/route';

interface ManeuverListProps {
  maneuvers: ValhallaManeuver[];
  currentIndex: number;
}

export function ManeuverList({ maneuvers, currentIndex }: ManeuverListProps) {
  return (
    <FlatList
      data={maneuvers}
      keyExtractor={(_, i) => String(i)}
      style={styles.list}
      renderItem={({ item, index }) => (
        <View style={[styles.item, index === currentIndex && styles.activeItem]}>
          <View style={styles.stepBadge}>
            <Text style={styles.stepNumber}>{index + 1}</Text>
          </View>
          <View style={styles.info}>
            <Text style={[styles.instruction, index < currentIndex && styles.pastText]}>
              {item.instruction}
            </Text>
            <Text style={styles.distance}>{formatDistance(item.distanceMeters)}</Text>
          </View>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  activeItem: {
    backgroundColor: colors.primaryLight + '20',
  },
  stepBadge: {
    width: 28,
    height: 28,
    borderRadius: borderRadius.round,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  stepNumber: {
    ...typography.caption,
    color: colors.white,
    fontWeight: '700',
  },
  info: {
    flex: 1,
  },
  instruction: {
    ...typography.body,
    color: colors.text,
  },
  pastText: {
    color: colors.textSecondary,
  },
  distance: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
});
