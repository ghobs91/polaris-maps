import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NavigationStepsContent } from './NavigationStepsList';
import { formatDistance, formatDuration } from '../../utils/units';
import { nav } from '../../constants/theme';
import type { ValhallaRoute } from '../../models/route';

interface NavigationDirectionsFeedProps {
  route: ValhallaRoute | null;
  currentStepIndex: number;
  etaSeconds: number | null;
  remainingDistanceMeters: number | null;
  destinationName?: string;
  /** Open the add-stop search. */
  onAddStop: () => void;
  /** End the navigation session. */
  onEnd: () => void;
  /** Optional line pinned under the list. */
  footerText?: string | null;
  /** Narrow 30% pane in the landscape capture split. */
  compact?: boolean;
  /** Style for the feed container (e.g. flex: 1 inside a pane). */
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
}

/**
 * The destination header, add-stop search, and vertically scrolling maneuver
 * list shared by the CarPlay companion and the landscape capture split. Dark
 * by design: both callers place it on the navigation surface.
 */
export function NavigationDirectionsFeed({
  route,
  currentStepIndex,
  etaSeconds,
  remainingDistanceMeters,
  destinationName,
  onAddStop,
  onEnd,
  footerText,
  compact = false,
  style,
  contentContainerStyle,
}: NavigationDirectionsFeedProps) {
  const summaryParts: string[] = [];
  if (etaSeconds != null) summaryParts.push(formatDuration(etaSeconds));
  if (remainingDistanceMeters != null) summaryParts.push(formatDistance(remainingDistanceMeters));

  return (
    <View style={[styles.container, style]}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text
            style={[styles.destination, compact && styles.destinationCompact]}
            numberOfLines={1}
          >
            {destinationName ?? 'Destination'}
          </Text>
          {summaryParts.length > 0 && (
            <Text style={[styles.summary, compact && styles.summaryCompact]}>
              {summaryParts.join(' · ')}
            </Text>
          )}
        </View>
        <Pressable
          onPress={onEnd}
          style={({ pressed }) => [
            styles.endButton,
            compact && styles.endButtonCompact,
            { opacity: pressed ? 0.85 : 1 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="End navigation"
        >
          <Text style={[styles.endText, compact && styles.endTextCompact]}>End</Text>
        </Pressable>
      </View>

      <Pressable
        onPress={onAddStop}
        style={({ pressed }) => [
          styles.searchBar,
          compact && styles.searchBarCompact,
          { opacity: pressed ? 0.85 : 1 },
        ]}
        accessibilityRole="button"
        accessibilityLabel="Add a stop"
        accessibilityHint="Search for a place to add along your route"
      >
        <Ionicons name="search" size={compact ? 15 : 18} color="rgba(255,255,255,0.6)" />
        <Text style={[styles.searchPlaceholder, compact && styles.searchPlaceholderCompact]}>
          Add a stop
        </Text>
      </Pressable>

      <NavigationStepsContent
        route={route}
        currentStepIndex={currentStepIndex}
        contentContainerStyle={contentContainerStyle}
        style={styles.list}
        compact={compact}
      />

      {footerText ? (
        <Text style={[styles.footer, compact && styles.footerCompact]}>{footerText}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  headerText: { flex: 1 },
  destination: { color: '#FFFFFF', fontSize: 20, fontWeight: '700' },
  destinationCompact: { fontSize: 17 },
  summary: { color: 'rgba(255,255,255,0.6)', fontSize: 14, marginTop: 2 },
  summaryCompact: { fontSize: 12, marginTop: 1 },
  endButton: {
    backgroundColor: nav.dangerSubtle,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  endButtonCompact: { paddingVertical: 6, paddingHorizontal: 12 },
  endText: { color: nav.danger, fontSize: 15, fontWeight: '700' },
  endTextCompact: { fontSize: 13 },
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
  searchBarCompact: {
    gap: 6,
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 10,
    marginTop: 10,
  },
  searchPlaceholder: { color: 'rgba(255,255,255,0.6)', fontSize: 16 },
  searchPlaceholderCompact: { fontSize: 13 },
  list: { flex: 1, marginTop: 6 },
  footer: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 8,
  },
  footerCompact: { fontSize: 10, marginTop: 6 },
});
