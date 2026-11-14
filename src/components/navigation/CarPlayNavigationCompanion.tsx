import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavigationDirectionsFeed } from './NavigationDirectionsFeed';
import { useTheme } from '../../contexts/ThemeContext';
import type { ValhallaRoute } from '../../models/route';
import type { NextStop } from '../../utils/navigationStops';

interface CarPlayNavigationCompanionProps {
  route: ValhallaRoute | null;
  currentStepIndex: number;
  etaSeconds: number | null;
  remainingDistanceMeters: number | null;
  destinationName?: string;
  /** Pending waypoint; the header counts down to it instead of the destination. */
  nextStop?: NextStop | null;
  /** Height of the live capture band at the bottom (0 when not capturing). */
  bottomInset?: number;
  /** Narrow 30% pane in the landscape capture split. */
  split?: boolean;
  /** Open the add-stop search (a waypoint along the route). */
  onAddStop: () => void;
  /** End the navigation session. */
  onEnd: () => void;
}

/**
 * Phone view shown while navigation is driven from CarPlay: the turn-by-turn
 * step list plus a search bar for adding a waypoint along the route, matching
 * Apple Maps (the car screen shows the map; the phone becomes the companion).
 * In landscape with a live capture it occupies the 30% directions pane.
 */
export function CarPlayNavigationCompanion({
  route,
  currentStepIndex,
  etaSeconds,
  remainingDistanceMeters,
  destinationName,
  nextStop,
  bottomInset = 0,
  split = false,
  onAddStop,
  onEnd,
}: CarPlayNavigationCompanionProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.backgroundDark,
          paddingTop: split ? insets.top + 8 : insets.top + 12,
          paddingBottom: split ? insets.bottom + 8 : insets.bottom + 12 + bottomInset,
          paddingHorizontal: split ? 12 : 16,
        },
      ]}
    >
      <NavigationDirectionsFeed
        route={route}
        currentStepIndex={currentStepIndex}
        etaSeconds={etaSeconds}
        remainingDistanceMeters={remainingDistanceMeters}
        destinationName={destinationName}
        nextStop={nextStop}
        onAddStop={onAddStop}
        onEnd={onEnd}
        footerText="Turn-by-turn guidance is on CarPlay"
        compact={split}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
