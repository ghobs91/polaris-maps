import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { spacing, typography, borderRadius } from '../../constants/theme';
import { useTheme } from '../../contexts/ThemeContext';
import { GlassView } from '../common/GlassView';

interface MetricCardProps {
  label: string;
  value: string | number;
  unit?: string;
}

export function MetricCard({ label, value, unit }: MetricCardProps) {
  const { colors } = useTheme();
  return (
    <GlassView material="regular" style={styles.card}>
      <Text style={[styles.value, { color: colors.primary }]}>
        {value}
        {unit && <Text style={[styles.unit, { color: colors.textSecondary }]}> {unit}</Text>}
      </Text>
      <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
    </GlassView>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: borderRadius.md,
    overflow: 'hidden',
    borderCurve: 'continuous',
    padding: spacing.md,
    flex: 1,
    minWidth: 140,
    alignItems: 'center',
  },
  value: {
    ...typography.h2,
    marginBottom: spacing.xs,
  },
  unit: {
    ...typography.caption,
  },
  label: {
    ...typography.caption,
    textAlign: 'center',
  },
});
