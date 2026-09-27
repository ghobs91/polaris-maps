import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSettingsStore } from '../../stores/settingsStore';
import { formatSpeed, mphToKmh } from '../../utils/units';
import { MAX_FONT_SCALE_DENSE } from '../../constants/a11y';
import { nav } from '../../constants/theme';

interface SpeedClusterProps {
  /** Posted limit in mph, or null when the road has no limit data. */
  speedLimitMph: number | null;
  /** Current speed in mph, or null when unavailable. */
  speedMph: number | null;
  /** Highlights the current speed once the driver is over the limit. */
  over: boolean;
}

/**
 * Speed limit and current speed as one sign.
 *
 * The two used to render as separate widgets — a white MUTCD plate beside a
 * dark badge — which read as two unrelated things and left the current speed
 * as the least legible element on the screen. They now share a single white
 * field with the sign's black border, split by a hairline.
 *
 * White is deliberate: it is the one surface that stays readable in direct
 * sunlight, and it is how the speed limit is signed everywhere on the road.
 * Being over the limit turns only the numeral red, rather than flooding a
 * whole tile — the spike of colour is the signal, and it stays a spike.
 *
 * The full 52×68 stacked plate stays in `SpeedLimitSign` for surfaces that
 * want the literal sign (CarPlay mirrors it).
 */
export function SpeedCluster({ speedLimitMph, speedMph, over }: SpeedClusterProps) {
  const useMetric = useSettingsStore((s) => s.useMetric);

  const hasLimit = speedLimitMph != null;
  const hasSpeed = speedMph != null && Number.isFinite(speedMph) && speedMph >= 1;
  if (!hasLimit && !hasSpeed) return null;

  const limitValue = hasLimit
    ? Math.round(useMetric ? mphToKmh(speedLimitMph) : speedLimitMph)
    : null;
  const speedValue = hasSpeed ? Math.round(useMetric ? mphToKmh(speedMph) : speedMph) : null;
  const unit = useMetric ? 'km/h' : 'mph';

  const parts = [
    hasLimit ? `speed limit ${formatSpeed(speedLimitMph, useMetric)}` : null,
    hasSpeed ? `current speed ${speedValue} ${unit}${over ? ', over the speed limit' : ''}` : null,
  ].filter(Boolean);

  return (
    <View style={styles.container} accessibilityRole="text" accessibilityLabel={parts.join(', ')}>
      {hasLimit && (
        <>
          <View style={styles.limitCell}>
            <Text style={styles.limitValue} maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}>
              {limitValue}
            </Text>
          </View>
          {hasSpeed && <View style={styles.divider} />}
        </>
      )}

      {hasSpeed && (
        <View style={styles.speedCell}>
          <Text
            style={[styles.speedValue, over && styles.speedValueOver]}
            maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}
          >
            {speedValue}
          </Text>
          <Text style={styles.speedUnit} maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}>
            {unit}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderCurve: 'continuous',
    borderWidth: 2,
    borderColor: '#000000',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  limitCell: {
    minWidth: 50,
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  limitValue: {
    fontVariant: ['tabular-nums'],
    fontSize: 26,
    fontWeight: '800',
    lineHeight: 30,
    color: '#000000',
  },
  divider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  speedCell: {
    minWidth: 52,
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speedValue: {
    fontVariant: ['tabular-nums'],
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 26,
    color: '#1F1F1F',
  },
  speedValueOver: {
    color: nav.dangerInk,
  },
  speedUnit: {
    fontSize: 10,
    fontWeight: '700',
    color: '#5F6368',
    marginTop: -1,
  },
});
