import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MapView } from '@/components/map/MapView';
import { NextTurnBanner, ManeuverList, EtaDisplay } from '@/components/navigation';
import { useNavigationStore } from '@/stores/navigationStore';
import { Button } from '@/components/common';
import { colors, spacing, typography } from '@/constants/theme';

export default function NavigationScreen() {
  const {
    activeRoute,
    currentManeuver,
    currentStepIndex,
    etaSeconds,
    remainingDistanceMeters,
    isNavigating,
    stopNavigation,
  } = useNavigationStore();

  if (!isNavigating || !activeRoute) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No active navigation</Text>
        <Text style={styles.emptyHint}>Search for a destination and start a route</Text>
      </View>
    );
  }

  const allManeuvers = activeRoute.legs.flatMap((l) => l.maneuvers);

  return (
    <View style={styles.container}>
      <NextTurnBanner maneuver={currentManeuver} />
      <View style={styles.mapContainer}>
        <MapView routeGeometry={activeRoute.geometry} />
      </View>
      <EtaDisplay etaSeconds={etaSeconds} remainingDistanceMeters={remainingDistanceMeters} />
      <ManeuverList maneuvers={allManeuvers} currentIndex={currentStepIndex} />
      <View style={styles.footer}>
        <Button title="End Navigation" onPress={stopNavigation} variant="outline" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  mapContainer: { flex: 1 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  emptyText: { ...typography.h3, color: colors.text, marginBottom: spacing.xs },
  emptyHint: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  footer: { padding: spacing.md },
});
