import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { LaneDirection, LaneGuidance as LaneGuidanceType } from '../../models/route';

interface LaneGuidanceProps {
  laneGuidance: LaneGuidanceType;
}

/** Icon + rotation for a lane arrow. Straight-ish arrows share one glyph so
 *  weights match; turns rotate it like the maneuver banner icons. */
function getLaneGlyph(direction: LaneDirection): { name: string; rotate: number } {
  switch (direction) {
    case 'left':
      return { name: 'arrow-up', rotate: -90 };
    case 'slight_left':
      return { name: 'arrow-up', rotate: -45 };
    case 'straight':
      return { name: 'arrow-up', rotate: 0 };
    case 'slight_right':
      return { name: 'arrow-up', rotate: 45 };
    case 'right':
      return { name: 'arrow-up', rotate: 90 };
    case 'merge_left':
      return { name: 'arrow-up', rotate: -30 };
    case 'merge_right':
      return { name: 'arrow-up', rotate: 30 };
    case 'u_turn':
      return { name: 'return-up-back', rotate: 0 };
    default:
      return { name: 'arrow-up', rotate: 0 };
  }
}

/**
 * Google-style lane strip: one arrow per lane, recommended lanes bright
 * white, the rest dimmed. Rendered as the bottom row of the turn banner so
 * the driver sees at a glance which lane to be in for the exit/merge.
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
          const { name, rotate } = getLaneGlyph(direction);

          return (
            <View key={index} style={styles.lane}>
              <Ionicons
                name={name as any}
                size={26}
                color={isActive ? '#FFFFFF' : 'rgba(255,255,255,0.35)'}
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
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(0,0,0,0.2)',
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
    backgroundColor: 'rgba(255,255,255,0.15)',
    marginLeft: 14,
  },
});
