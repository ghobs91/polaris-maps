import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../../constants/theme';

const LEGEND_ITEMS = [
  { label: 'Free Flow', color: colors.traffic.freeFlow },
  { label: 'Slow', color: colors.traffic.slow },
  { label: 'Congested', color: colors.traffic.congested },
  { label: 'Stopped', color: colors.traffic.stopped },
] as const;

export function TrafficLegend() {
  return (
    <View style={styles.container}>
      {LEGEND_ITEMS.map((item) => (
        <View key={item.label} style={styles.row}>
          <View style={[styles.swatch, { backgroundColor: item.color }]} />
          <Text style={styles.label}>{item.label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 24,
    left: 12,
    backgroundColor: colors.glass.backgroundDark,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 2,
  },
  swatch: {
    width: 14,
    height: 4,
    borderRadius: 2,
    marginRight: 8,
  },
  label: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.85)',
  },
});
