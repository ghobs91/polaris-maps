import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NavigationStepsContent } from './NavigationStepsList';
import { formatDistance, formatDuration } from '../../utils/units';
import { useTheme } from '../../contexts/ThemeContext';
import { nav } from '../../constants/theme';
import type { ValhallaRoute } from '../../models/route';
import type { NextStop } from '../../utils/navigationStops';

interface CarPlayNavigationCompanionProps {
  route: ValhallaRoute | null;
  currentStepIndex: number;
  etaSeconds: number | null;
  remainingDistanceMeters: number | null;
  destinationName?: string;
  /** Pending waypoint; the first ETA counts down to it. */
  nextStop?: NextStop | null;
  /** Open the add-stop search (a waypoint along the route). */
  onAddStop: () => void;
  /** End the navigation session. */
  onEnd: () => void;
}

function formatClock(etaSeconds: number): string {
  return new Date(Date.now() + etaSeconds * 1000).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Phone view shown while navigation is driven from CarPlay: the map sits above
 * this sheet, which carries the next-stop and whole-trip ETA, the step list,
 * and an add-stop search bar, matching Apple Maps.
 */
export function CarPlayNavigationCompanion({
  route,
  currentStepIndex,
  etaSeconds,
  remainingDistanceMeters,
  destinationName,
  nextStop,
  onAddStop,
  onEnd,
}: CarPlayNavigationCompanionProps) {
  const { colors } = useTheme();

  const tripParts: string[] = [];
  if (etaSeconds != null) tripParts.push(formatDuration(etaSeconds));
  if (remainingDistanceMeters != null) tripParts.push(formatDistance(remainingDistanceMeters));
  if (etaSeconds != null) tripParts.push(`arrive ${formatClock(etaSeconds)}`);

  const nextStopLabel = nextStop
    ? `Next · ${nextStop.name} · ${formatDuration(nextStop.etaSeconds)}`
    : null;

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.backgroundDark,
        },
      ]}
    >
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.destination} numberOfLines={1}>
            {nextStop ? nextStopLabel : (destinationName ?? 'Destination')}
          </Text>
          {tripParts.length > 0 && (
            <Text style={styles.summary} numberOfLines={1}>
              {nextStop ? `${destinationName ?? 'Destination'} · ` : ''}
              {tripParts.join(' · ')}
            </Text>
          )}
        </View>
        <Pressable
          onPress={onEnd}
          style={({ pressed }) => [styles.endButton, { opacity: pressed ? 0.85 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel="End navigation"
        >
          <Text style={styles.endText}>End</Text>
        </Pressable>
      </View>

      <Pressable
        onPress={onAddStop}
        style={({ pressed }) => [styles.searchBar, { opacity: pressed ? 0.85 : 1 }]}
        accessibilityRole="button"
        accessibilityLabel="Add a stop"
        accessibilityHint="Search for a place to add along your route"
      >
        <Ionicons name="search" size={18} color="rgba(255,255,255,0.6)" />
        <Text style={styles.searchPlaceholder}>Add a stop</Text>
      </Pressable>

      <NavigationStepsContent
        route={route}
        currentStepIndex={currentStepIndex}
        contentContainerStyle={styles.listContent}
        style={styles.list}
      />

      <Text style={styles.carPlayHint}>Turn-by-turn guidance is on CarPlay</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerText: { flex: 1 },
  destination: { color: '#FFFFFF', fontSize: 20, fontWeight: '700' },
  summary: { color: 'rgba(255,255,255,0.6)', fontSize: 14, marginTop: 2 },
  endButton: {
    backgroundColor: nav.dangerSubtle,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  endText: { color: nav.danger, fontSize: 15, fontWeight: '700' },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 16,
  },
  searchPlaceholder: { color: 'rgba(255,255,255,0.6)', fontSize: 16 },
  list: { flex: 1, marginTop: 8 },
  listContent: { paddingBottom: 8 },
  carPlayHint: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 8,
  },
});
