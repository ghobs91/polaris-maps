import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MAX_FONT_SCALE_CHROME } from '../../constants/a11y';
import { useRoutingTier } from '../../hooks/useRoutingTier';
import type { RoutingTierStatus } from '../../services/routing/routingService';

const TIER_LABELS: Record<RoutingTierStatus, string> = {
  'on-device': 'On-device Valhalla',
  osrm: 'OSRM',
  mapkit: 'Apple MapKit',
  fossgis: 'FOSSGIS Valhalla',
  unavailable: 'No route',
};

/** Tier 1 is the healthy path; anything else means a fallback answered. */
const TIER_COLORS: Record<RoutingTierStatus, string> = {
  'on-device': '#34C759',
  osrm: '#0A84FF',
  mapkit: '#FF9F0A',
  fossgis: '#FF9F0A',
  unavailable: '#FF453A',
};

/**
 * Developer-mode indicator for the routing cascade: which engine actually
 * computed the route on screen, and whether it was a fallback.
 *
 * Render it only when `settingsStore.devMode` is on — it is diagnostic chrome,
 * not user-facing UI.
 */
export function RoutingTierBadge() {
  const state = useRoutingTier();
  if (!state) return null;

  const label = TIER_LABELS[state.tier];
  const suffix = state.degraded && state.tier !== 'unavailable' ? ' (fallback)' : '';

  return (
    <View
      style={styles.badge}
      accessibilityRole="text"
      accessibilityLabel={`Routing engine: ${label}${suffix}`}
    >
      <View style={[styles.dot, { backgroundColor: TIER_COLORS[state.tier] }]} />
      <Text style={styles.text} maxFontSizeMultiplier={MAX_FONT_SCALE_CHROME}>
        {`Route: ${label}${suffix}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(28,28,30,0.82)',
    borderRadius: 12,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  text: {
    color: '#EBEBF0',
    fontSize: 11,
    fontWeight: '600',
  },
});
