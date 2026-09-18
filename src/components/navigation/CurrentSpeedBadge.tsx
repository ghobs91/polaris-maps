import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSettingsStore } from '../../stores/settingsStore';
import { mphToKmh } from '../../utils/units';
import { MAX_FONT_SCALE_DENSE } from '../../constants/a11y';

interface CurrentSpeedBadgeProps {
  /** Current speed in mph, or null when unavailable. */
  speedMph: number | null;
  /** When true, the badge is highlighted as an over-speed warning. */
  over: boolean;
}

/** Current vehicle speed, shown in the user's units and hidden when unknown. */
export function CurrentSpeedBadge({ speedMph, over }: CurrentSpeedBadgeProps) {
  const useMetric = useSettingsStore((s) => s.useMetric);

  if (speedMph == null || !Number.isFinite(speedMph) || speedMph < 1) return null;

  const value = Math.round(useMetric ? mphToKmh(speedMph) : speedMph);
  const unit = useMetric ? 'km/h' : 'mph';

  return (
    <View
      style={[styles.badge, over && styles.badgeOver]}
      accessibilityRole="text"
      accessibilityLabel={`Current speed ${value} ${unit}${over ? ', over the speed limit' : ''}`}
    >
      <Text
        style={[styles.value, over && styles.valueOver]}
        maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}
      >
        {value}
      </Text>
      <Text
        style={[styles.unit, over && styles.unitOver]}
        maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}
      >
        {unit}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    width: 56,
    minHeight: 68,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(28,28,30,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  badgeOver: {
    borderColor: '#FF3B30',
    backgroundColor: 'rgba(255,59,48,0.92)',
  },
  value: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '800',
    lineHeight: 28,
  },
  valueOver: {
    color: '#FFFFFF',
  },
  unit: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 10,
    fontWeight: '700',
  },
  unitOver: {
    color: 'rgba(255,255,255,0.9)',
  },
});
