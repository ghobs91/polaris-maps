import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, typography, borderRadius } from '../../constants/theme';

interface MetricCardProps {
  label: string;
  value: string | number;
  unit?: string;
}

export function MetricCard({ label, value, unit }: MetricCardProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.value}>
        {value}
        {unit && <Text style={styles.unit}> {unit}</Text>}
      </Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    flex: 1,
    minWidth: 140,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  value: {
    ...typography.h2,
    color: colors.primary,
    marginBottom: spacing.xs,
  },
  unit: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  label: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
