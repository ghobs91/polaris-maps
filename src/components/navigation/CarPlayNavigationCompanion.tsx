import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavigationStepsContent } from './NavigationStepsList';
import { formatDistance, formatDuration } from '../../utils/units';
import { useTheme } from '../../contexts/ThemeContext';
import type { ValhallaRoute } from '../../models/route';

interface CarPlayNavigationCompanionProps {
  route: ValhallaRoute | null;
  currentStepIndex: number;
  etaSeconds: number | null;
  remainingDistanceMeters: number | null;
  destinationName?: string;
  /** Open the add-stop search (a waypoint along the route). */
  onAddStop: () => void;
  /** End the navigation session. */
  onEnd: () => void;
}

/**
 * Phone view shown while navigation is driven from CarPlay: the turn-by-turn
 * step list plus a search bar for adding a waypoint along the route, matching
 * Apple Maps (the car screen shows the map; the phone becomes the companion).
 */
export function CarPlayNavigationCompanion({
  route,
  currentStepIndex,
  etaSeconds,
  remainingDistanceMeters,
  destinationName,
  onAddStop,
  onEnd,
}: CarPlayNavigationCompanionProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const summaryParts: string[] = [];
  if (etaSeconds != null) summaryParts.push(formatDuration(etaSeconds));
  if (remainingDistanceMeters != null) summaryParts.push(formatDistance(remainingDistanceMeters));

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.backgroundDark,
          paddingTop: insets.top + 12,
          paddingBottom: insets.bottom + 12,
        },
      ]}
    >
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.destination} numberOfLines={1}>
            {destinationName ?? 'Destination'}
          </Text>
          {summaryParts.length > 0 && (
            <Text style={styles.summary}>{summaryParts.join(' · ')}</Text>
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
  container: { flex: 1, paddingHorizontal: 16 },
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
    backgroundColor: 'rgba(255,59,48,0.18)',
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  endText: { color: '#FF453A', fontSize: 15, fontWeight: '700' },
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
