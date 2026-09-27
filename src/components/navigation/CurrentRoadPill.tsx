import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { nav } from '../../constants/theme';
import { MAX_FONT_SCALE_DENSE } from '../../constants/a11y';

interface CurrentRoadPillProps {
  /** Road being travelled, or null when unnamed/unknown. */
  roadName: string | null;
}

/**
 * The road you are on right now.
 *
 * The turn banner answers "where do I turn", which leaves a gap when the next
 * turn is a mile away and the driver simply wants to confirm they are on the
 * right road. This is the map's own answer to that, pinned above the ETA bar
 * so it sits with the rest of the trip readout rather than competing with the
 * banner.
 *
 * Renders nothing when the road is unnamed — an empty pill is just clutter.
 */
export function CurrentRoadPill({ roadName }: CurrentRoadPillProps) {
  if (!roadName) return null;

  return (
    <View style={styles.pill} accessibilityRole="text" accessibilityLabel={`On ${roadName}`}>
      <Text
        style={styles.label}
        numberOfLines={1}
        ellipsizeMode="tail"
        maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}
      >
        {roadName}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    // centred over the map, capped so a long name can't run under the FAB rail
    maxWidth: '68%',
    backgroundColor: 'rgba(10,132,255,0.92)',
    borderRadius: 999,
    borderCurve: 'continuous',
    paddingVertical: 8,
    paddingHorizontal: 14,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  label: {
    color: nav.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
});
