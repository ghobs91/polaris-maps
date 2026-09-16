import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTrafficStore } from '../../stores/trafficStore';
import {
  resolveTrafficCoverage,
  TRAFFIC_COVERAGE_LABELS,
  type TrafficCoverage,
} from '../../services/traffic/trafficCoverage';

const COVERAGE_COLORS: Record<TrafficCoverage, string> = {
  p2p: '#34C759',
  'open-feed': '#0A84FF',
  'cold-start': '#FF9F0A',
  local: '#8E8E93',
  stale: '#FFD60A',
  'no-data': '#FF453A',
};

/**
 * Compact traffic coverage indicator: distinguishes peer-sourced, open-feed,
 * cold-start, on-device, stale, and no-data states instead of silently
 * rendering an empty or stale overlay.
 */
export function TrafficCoverageBadge() {
  const lastResolveSource = useTrafficStore((s) => s.lastResolveSource);
  const lastExternalFetchAt = useTrafficStore((s) => s.lastExternalFetchAt);

  const coverage = resolveTrafficCoverage(lastResolveSource, lastExternalFetchAt);
  const label = TRAFFIC_COVERAGE_LABELS[coverage];

  return (
    <View
      style={styles.badge}
      accessibilityRole="text"
      accessibilityLabel={`Traffic coverage: ${label}`}
    >
      <View style={[styles.dot, { backgroundColor: COVERAGE_COLORS[coverage] }]} />
      <Text style={styles.text}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(28,28,30,0.82)',
    borderRadius: 12,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  text: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
  },
});
