import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, typography } from '../../constants/theme';

interface EtaDisplayProps {
  etaSeconds: number | null;
  remainingDistanceMeters: number | null;
}

export function EtaDisplay({ etaSeconds, remainingDistanceMeters }: EtaDisplayProps) {
  if (etaSeconds == null) return null;

  return (
    <View style={styles.container}>
      <View style={styles.stat}>
        <Text style={styles.value}>{formatDuration(etaSeconds)}</Text>
        <Text style={styles.label}>ETA</Text>
      </View>
      {remainingDistanceMeters != null && (
        <View style={styles.stat}>
          <Text style={styles.value}>{formatDistance(remainingDistanceMeters)}</Text>
          <Text style={styles.label}>Remaining</Text>
        </View>
      )}
    </View>
  );
}

function formatDuration(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.ceil((seconds % 3600) / 60);
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins} min`;
}

function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  stat: {
    alignItems: 'center',
  },
  value: {
    ...typography.h3,
    color: colors.text,
    fontWeight: '700',
  },
  label: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});
