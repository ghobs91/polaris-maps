import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { borderRadius, nav, shadow, spacing } from '../../constants/theme';
import { GlassView } from '../common/GlassView';
import { formatDistanceParts } from '../../utils/units';
import { maneuverGlyph } from './maneuverGlyphs';
import type { ValhallaManeuver, LaneGuidance as LaneGuidanceType } from '../../models/route';
import { LaneGuidance } from './LaneGuidance';

interface NextTurnBannerProps {
  maneuver: ValhallaManeuver | null;
  nextManeuver?: ValhallaManeuver | null;
  /** Live remaining distance to the next turn (overrides the static route value). */
  distanceToTurnMeters?: number;
  /** Lane arrows for the current maneuver; shown as the card's bottom strip. */
  laneGuidance?: LaneGuidanceType | null;
}

export function NextTurnBanner({
  maneuver,
  nextManeuver,
  distanceToTurnMeters,
  laneGuidance,
}: NextTurnBannerProps) {
  if (!maneuver) return null;

  const { name: iconName, rotate } = maneuverGlyph(maneuver.type);
  const instruction = maneuver.verbalPreTransition || maneuver.instruction;
  const nextIcon = nextManeuver ? maneuverGlyph(nextManeuver.type) : null;

  // Use live countdown distance when available; fall back to the static route value.
  const displayDistance = distanceToTurnMeters ?? maneuver.distanceMeters;
  // The numeral leads and the unit trails it at a smaller size, so the card
  // reads at a glance instead of as a sentence.
  const distance = formatDistanceParts(displayDistance);

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
      accessibilityLabel={`Next turn: ${exitSpoken ? `${exitSpoken}, ` : ''}${instruction}, in ${distance.value} ${distance.unit}`}
    >
      {/* Main turn row */}
      <View style={styles.mainRow}>
        <MaterialCommunityIcons
          name={iconName as any}
          size={44}
          color={nav.textPrimary}
          style={rotate !== 0 ? { transform: [{ rotate: `${rotate}deg` }] } : undefined}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
        <View style={styles.textBox}>
          <Text
            style={styles.distance}
            numberOfLines={1}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            {distance.value}
            <Text style={styles.distanceUnit}> {distance.unit}</Text>
          </Text>
          <Text
            style={styles.street}
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
          <MaterialCommunityIcons
            name={nextIcon.name as any}
            size={15}
            color={nav.textMuted}
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

      {/* Lane guidance strip — which lane to be in for the exit/merge.
          Shares the card surface; only a hairline separates it. */}
      {laneGuidance && <LaneGuidance laneGuidance={laneGuidance} />}
    </GlassView>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: nav.surface,
    borderRadius: borderRadius.xxl,
    borderCurve: 'continuous',
    overflow: 'hidden',
    ...shadow.lg,
  },
  mainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: spacing.md,
    gap: 16,
  },
  textBox: {
    flex: 1,
  },
  distance: {
    // Tabular figures keep the countdown from jittering as the digits change.
    fontVariant: ['tabular-nums'],
    fontSize: 34,
    fontWeight: '700',
    letterSpacing: -0.5,
    lineHeight: 38,
    color: nav.textPrimary,
  },
  distanceUnit: {
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: 0,
    color: nav.textSecondary,
  },
  street: {
    fontSize: 21,
    fontWeight: '600',
    lineHeight: 26,
    marginTop: 2,
    color: nav.textPrimary,
  },
  exitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: nav.separator,
  },
  exitBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: nav.textPrimary,
    borderRadius: 8,
    borderCurve: 'continuous',
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  exitBadgeLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
    color: nav.surfaceSolid,
  },
  exitBadgeNumber: {
    fontSize: 18,
    fontWeight: '800',
    color: nav.surfaceSolid,
  },
  exitText: {
    flex: 1,
  },
  exitName: {
    fontSize: 15,
    fontWeight: '700',
    color: nav.textPrimary,
  },
  exitToward: {
    fontSize: 13,
    color: nav.textMuted,
    marginTop: 1,
  },
  thenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: nav.separator,
  },
  thenLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: nav.textMuted,
  },
  thenStreet: {
    fontSize: 13,
    color: nav.textMuted,
    flex: 1,
  },
});
