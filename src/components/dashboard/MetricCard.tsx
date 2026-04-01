import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { spacing, typography, borderRadius } from '../../constants/theme';
import { useTheme } from '../../contexts/ThemeContext';

interface MetricCardProps {
  label: string;
  value: string | number;
  unit?: string;
}

export function MetricCard({ label, value, unit }: MetricCardProps) {
  const { colors } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.value, { color: colors.primary }]}>
        {value}
        {unit && <Text style={[styles.unit, { color: colors.textSecondary }]}> {unit}</Text>}
      </Text>
      <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: borderRadius.md,
    padding: spacing.md,
    flex: 1,
    minWidth: 140,
    borderWidth: 1,
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
