import React from 'react';
import { View, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { nav } from '../../constants/theme';
import { laneGlyph } from './maneuverGlyphs';
import type { LaneGuidance as LaneGuidanceType } from '../../models/route';

interface LaneGuidanceProps {
  laneGuidance: LaneGuidanceType;
}

/**
 * Lane strip: one arrow per lane, recommended lanes bright and heavy, the rest
 * dimmed and light. Rendered as the bottom row of the turn banner so the
 * driver sees at a glance which lane to be in for the exit/merge.
 */
export function LaneGuidance({ laneGuidance }: LaneGuidanceProps) {
  const { laneCount, activeLanes, laneDirections } = laneGuidance;

  if (laneCount < 2 || laneDirections.length < 2) return null;

  return (
    <View
      style={styles.container}
      accessibilityLabel={`Use ${activeLanes.length} of ${laneCount} lanes`}
    >
      <View style={styles.lanesRow}>
        {laneDirections.map((direction, index) => {
          const isActive = activeLanes.includes(index);
          const { name, rotate } = laneGlyph(direction, isActive);

          return (
            <View key={index} style={styles.lane}>
              <MaterialCommunityIcons
                name={name as any}
                size={26}
                color={isActive ? nav.laneActive : nav.laneInactive}
                style={rotate !== 0 ? { transform: [{ rotate: `${rotate}deg` }] } : undefined}
              />
              {index < laneDirections.length - 1 && <View style={styles.divider} />}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: nav.separator,
    alignItems: 'center',
  },
  lanesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 14,
  },
  lane: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  divider: {
    width: 1,
    height: 22,
    backgroundColor: nav.divider,
    marginLeft: 14,
  },
});
