import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { LaneGuidance as LaneGuidanceType } from '../../models/route';

interface LaneGuidanceProps {
  laneGuidance: LaneGuidanceType;
}

/** Get the appropriate Ionicons name for a lane direction */
function getLaneIcon(direction: LaneGuidanceType['laneDirections'][0]): string {
  switch (direction) {
    case 'left':
      return 'arrow-back';
    case 'slight_left':
      return 'arrow-up';
    case 'straight':
      return 'arrow-up';
    case 'slight_right':
      return 'arrow-up';
    case 'right':
      return 'arrow-forward';
    default:
      return 'arrow-up';
  }
}

/** Get rotation angle for lane direction */
function getLaneRotation(direction: LaneGuidanceType['laneDirections'][0]): number {
  switch (direction) {
    case 'left':
      return -90;
    case 'slight_left':
      return -45;
    case 'straight':
      return 0;
    case 'slight_right':
      return 45;
    case 'right':
      return 90;
    default:
      return 0;
  }
}

/**
 * Lane guidance component showing which lanes to use at an upcoming maneuver.
 * Displays a row of lane indicators with active lanes highlighted.
 */
export function LaneGuidance({ laneGuidance }: LaneGuidanceProps) {
  const { laneCount, activeLanes, laneDirections } = laneGuidance;

  if (laneCount === 0) return null;

  return (
    <View
      style={styles.container}
      accessibilityLabel={`Use ${activeLanes.length} of ${laneCount} lanes`}
    >
      <View style={styles.lanesRow}>
        {laneDirections.map((direction, index) => {
          const isActive = activeLanes.includes(index);
          const iconName = getLaneIcon(direction);
          const rotation = getLaneRotation(direction);

          return (
            <View key={index} style={[styles.lane, isActive && styles.laneActive]}>
              <Ionicons
                name={iconName as any}
                size={16}
                color={isActive ? '#FFFFFF' : 'rgba(255,255,255,0.4)'}
                style={rotation !== 0 ? { transform: [{ rotate: `${rotation}deg` }] } : undefined}
              />
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 8,
    alignItems: 'center',
  },
  lanesRow: {
    flexDirection: 'row',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
  },
  lane: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  laneActive: {
    backgroundColor: '#007AFF',
  },
});
