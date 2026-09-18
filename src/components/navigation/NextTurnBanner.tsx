import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { shadow } from '../../constants/theme';
import { GlassView } from '../common/GlassView';
import { formatDistance } from '../../utils/units';
import type {
  ValhallaManeuver,
  ManeuverType,
  LaneGuidance as LaneGuidanceType,
} from '../../models/route';
import { LaneGuidance } from './LaneGuidance';

interface NextTurnBannerProps {
  maneuver: ValhallaManeuver | null;
  nextManeuver?: ValhallaManeuver | null;
  /** Live remaining distance to the next turn (overrides the static route value). */
  distanceToTurnMeters?: number;
  /** Lane arrows for the current maneuver; shown as a Google-style bottom strip. */
  laneGuidance?: LaneGuidanceType | null;
}

function getManeuverIcon(type: ManeuverType): { name: string; rotate: number } {
  switch (type) {
    case 'turn_left':
      return { name: 'arrow-up', rotate: -90 };
    case 'turn_right':
      return { name: 'arrow-up', rotate: 90 };
    case 'sharp_left':
      return { name: 'arrow-up', rotate: -135 };
    case 'sharp_right':
      return { name: 'arrow-up', rotate: 135 };
    case 'slight_left':
      return { name: 'arrow-up', rotate: -45 };
    case 'slight_right':
      return { name: 'arrow-up', rotate: 45 };
    case 'u_turn':
      return { name: 'return-up-back', rotate: 0 };
    case 'enter_roundabout':
    case 'exit_roundabout':
      return { name: 'sync', rotate: 0 };
    case 'destination':
      return { name: 'flag', rotate: 0 };
    case 'ferry':
      return { name: 'boat-outline', rotate: 0 };
    case 'merge_left':
      return { name: 'arrow-up', rotate: -30 };
    case 'merge_right':
      return { name: 'arrow-up', rotate: 30 };
    case 'exit_highway':
      return { name: 'arrow-up', rotate: 45 };
    default:
      return { name: 'arrow-up', rotate: 0 };
  }
}

export function NextTurnBanner({
  maneuver,
  nextManeuver,
  distanceToTurnMeters,
  laneGuidance,
}: NextTurnBannerProps) {
  if (!maneuver) return null;

  const { name: iconName, rotate } = getManeuverIcon(maneuver.type);
  const instruction = maneuver.verbalPreTransition || maneuver.instruction;
  const nextIcon = nextManeuver ? getManeuverIcon(nextManeuver.type) : null;

  // Use live countdown distance when available; fall back to the static route value.
  const displayDistance = distanceToTurnMeters ?? maneuver.distanceMeters;

  // Interchange exit info (number + name/branch) so the exact exit is unambiguous.
  const exitName = maneuver.exitName ?? maneuver.exitBranch;
  const hasExitSign = Boolean(maneuver.exitNumber || exitName || maneuver.exitToward);
  const exitSpoken = maneuver.exitNumber ? `Exit ${maneuver.exitNumber}` : exitName;

  return (
    <GlassView
      material="regular"
      colorScheme="dark"
      style={styles.container}
      accessibilityRole="summary"
      accessibilityLabel={`Next turn: ${exitSpoken ? `${exitSpoken}, ` : ''}${instruction}, in ${formatDistance(displayDistance)}`}
    >
      {/* Main turn row */}
      <View style={styles.mainRow}>
        <View style={styles.iconBox}>
          <Ionicons
            name={iconName as any}
            size={36}
            color="#fff"
            style={rotate !== 0 ? { transform: [{ rotate: `${rotate}deg` }] } : undefined}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
        </View>
        <View style={styles.textBox}>
          <Text
            style={styles.distance}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            {formatDistance(displayDistance)}
          </Text>
          <Text
            style={styles.instruction}
            numberOfLines={2}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            {instruction}
          </Text>
        </View>
      </View>

      {/* Interchange exit — exact number + name, made prominent */}
      {hasExitSign && (
        <View style={styles.exitRow}>
          {maneuver.exitNumber ? (
            <View style={styles.exitBadge}>
              <Text style={styles.exitBadgeLabel}>EXIT</Text>
              <Text style={styles.exitBadgeNumber} numberOfLines={1}>
                {maneuver.exitNumber}
              </Text>
            </View>
          ) : null}
          <View style={styles.exitText}>
            {exitName ? (
              <Text style={styles.exitName} numberOfLines={1}>
                {exitName}
              </Text>
            ) : null}
            {maneuver.exitToward ? (
              <Text style={styles.exitToward} numberOfLines={1}>
                toward {maneuver.exitToward}
              </Text>
            ) : null}
          </View>
        </View>
      )}

      {/* "Then" secondary hint */}
      {nextManeuver && nextIcon && (
        <View style={styles.thenRow}>
          <Text style={styles.thenLabel}>Then</Text>
          <Ionicons
            name={nextIcon.name as any}
            size={14}
            color="rgba(255,255,255,0.55)"
            style={
              nextIcon.rotate !== 0
                ? { transform: [{ rotate: `${nextIcon.rotate}deg` }] }
                : undefined
            }
          />
          {nextManeuver.streetNames?.[0] && (
            <Text style={styles.thenStreet} numberOfLines={1}>
              {nextManeuver.streetNames[0]}
            </Text>
          )}
        </View>
      )}

      {/* Lane guidance strip — which lane to be in for the exit/merge */}
      {laneGuidance && <LaneGuidance laneGuidance={laneGuidance} />}
    </GlassView>
  );
}

const NAV_BG = '#1a2f3e';

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(26,47,62,0.72)',
    borderRadius: 16,
    overflow: 'hidden',
    ...shadow.lg,
  },
  mainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 14,
  },
  iconBox: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  textBox: {
    flex: 1,
  },
  distance: {
    fontSize: 28,
    fontWeight: '700',
    color: '#fff',
    lineHeight: 32,
  },
  instruction: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.75)',
    marginTop: 2,
    lineHeight: 20,
  },
  exitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  exitBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderCurve: 'continuous',
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  exitBadgeLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
    color: NAV_BG,
  },
  exitBadgeNumber: {
    fontSize: 18,
    fontWeight: '800',
    color: NAV_BG,
  },
  exitText: {
    flex: 1,
  },
  exitName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  exitToward: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.7)',
    marginTop: 1,
  },
  thenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  thenLabel: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.55)',
    fontWeight: '500',
  },
  thenStreet: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.55)',
    flex: 1,
  },
});
