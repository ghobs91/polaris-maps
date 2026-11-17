import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTrafficStore } from '../../stores/trafficStore';
import { MAX_FONT_SCALE_CHROME } from '../../constants/a11y';
import {
  resolveTrafficCoverage,
  summarizeTrafficBreakdown,
  TRAFFIC_COVERAGE_LABELS,
  type TrafficCoverage,
} from '../../services/traffic/trafficCoverage';

const COVERAGE_COLORS: Record<TrafficCoverage, string> = {
  p2p: '#34C759',
  'open-feed': '#0A84FF',
  'cold-start': '#FF9F0A',
  local: '#8E8E93',
  saved: '#30D158',
  stale: '#FFD60A',
  'no-data': '#FF453A',
};

/**
 * Developer-mode traffic provenance indicator.
 *
 * The headline distinguishes peer-sourced, open-feed, cold-start, on-device,
 * stale, and no-data coverage instead of silently rendering an empty or stale
 * overlay. The second line breaks the resolution down per tier, because the
 * headline alone follows the *highest* tier used: one cell needing a TomTom
 * seed would otherwise read as if the whole overlay came from TomTom, and a
 * local row that was originally seeded upstream would read as device data.
 */
export function TrafficCoverageBadge() {
  const lastResolveSource = useTrafficStore((s) => s.lastResolveSource);
  const lastExternalFetchAt = useTrafficStore((s) => s.lastExternalFetchAt);
  const breakdown = useTrafficStore((s) => s.lastResolveBreakdown);

  const coverage = resolveTrafficCoverage(lastResolveSource, lastExternalFetchAt);
  const label = TRAFFIC_COVERAGE_LABELS[coverage];
  const summary = breakdown ? summarizeTrafficBreakdown(breakdown) : '';
  // `seeded` marks local rows that were written by an upstream provider before
  // the index stopped accepting them, so "On-device history" stays honest.
  const localIsSeededOnly =
    breakdown != null && breakdown.localProbe === 0 && breakdown.localSeeded > 0;

  return (
    <View
      style={styles.badge}
      accessibilityRole="text"
      accessibilityLabel={
        summary ? `Traffic coverage: ${label}. Sources: ${summary}` : `Traffic coverage: ${label}`
      }
    >
      <View style={styles.row}>
        <View style={[styles.dot, { backgroundColor: COVERAGE_COLORS[coverage] }]} />
        <Text style={styles.text} maxFontSizeMultiplier={MAX_FONT_SCALE_CHROME}>
          {localIsSeededOnly ? `${label} (seeded)` : label}
        </Text>
      </View>
      {summary ? (
        <Text style={styles.breakdown} maxFontSizeMultiplier={MAX_FONT_SCALE_CHROME}>
          {summary}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'flex-start',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(28,28,30,0.82)',
    borderRadius: 12,
    paddingVertical: 4,
    paddingHorizontal: 10,
    gap: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
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
  breakdown: {
    color: '#A1A1AA',
    fontSize: 10,
    lineHeight: 13,
    maxWidth: 260,
  },
});
