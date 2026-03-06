import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, typography, borderRadius } from '../../constants/theme';
import type { ValhallaManeuver } from '../../models/route';

interface NextTurnBannerProps {
  maneuver: ValhallaManeuver | null;
}

export function NextTurnBanner({ maneuver }: NextTurnBannerProps) {
  if (!maneuver) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.instruction} numberOfLines={2}>
        {maneuver.verbalPreTransition || maneuver.instruction}
      </Text>
      <Text style={styles.distance}>{formatDistance(maneuver.distanceMeters)}</Text>
    </View>
  );
}

function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
  },
  instruction: {
    ...typography.subtitle,
    color: colors.white,
    fontWeight: '600',
  },
  distance: {
    ...typography.h3,
    color: colors.white,
    marginTop: spacing.xs,
  },
});
