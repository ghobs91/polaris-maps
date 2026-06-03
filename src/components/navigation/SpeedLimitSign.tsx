import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSettingsStore } from '../../stores/settingsStore';

interface SpeedLimitSignProps {
  /** Speed limit in mph */
  speedLimitMph: number;
}

/**
 * US-style speed limit sign rendered during active navigation.
 * Displays the posted speed limit in a white rectangle with a red border,
 * matching the standard MUTCD sign design.
 */
export function SpeedLimitSign({ speedLimitMph }: SpeedLimitSignProps) {
  const useMetric = useSettingsStore((s) => s.useMetric);

  const displaySpeed = useMetric ? Math.round(speedLimitMph * 1.60934) : speedLimitMph;

  return (
    <View
      style={styles.container}
      accessibilityLabel={`Speed limit ${displaySpeed} ${useMetric ? 'kilometers' : 'miles'} per hour`}
      accessibilityRole="text"
    >
      <Text style={styles.label}>SPEED</Text>
      <Text style={styles.label}>LIMIT</Text>
      <Text style={styles.speed}>{displaySpeed}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: 52,
    height: 68,
    backgroundColor: '#FFFFFF',
    borderRadius: 6,
    borderWidth: 3,
    borderColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  label: {
    fontSize: 8,
    fontWeight: '800',
    color: '#000',
    letterSpacing: 0.5,
    lineHeight: 10,
  },
  speed: {
    fontSize: 24,
    fontWeight: '800',
    color: '#000',
    lineHeight: 30,
    marginTop: 1,
  },
});
