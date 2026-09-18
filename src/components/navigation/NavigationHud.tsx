import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { EtaDisplay } from './EtaDisplay';
import { GlassView } from '../common/GlassView';
import type { NextStop, UpcomingStop } from '../../utils/navigationStops';
import { spacing, borderRadius, sheet as sheetTokens } from '../../constants/theme';

const SHEET_MAX_HEIGHT = 320;
const LIST_MAX_HEIGHT = 240;

function formatClock(etaSeconds: number): string {
  return new Date(Date.now() + etaSeconds * 1000).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

interface NavigationHudProps {
  etaSeconds: number | null;
  remainingDistanceMeters: number | null;
  destinationName?: string;
  /** The next pending stop; null/undefined when only the destination remains. */
  nextStop?: NextStop | null;
  upcomingStops: UpcomingStop[];
  onExit: () => void;
  onAddStop: () => void;
  onSkipStop: () => void;
  onRemoveStop: (waypointIndex: number) => void;
  onMoveStop: (waypointIndex: number, direction: -1 | 1) => void;
  onExpandedChange?: (expanded: boolean) => void;
}

/**
 * Bottom navigation HUD. Collapsed it shows the ETA bar and the next stop;
 * dragging the grabber up reveals every pending stop plus the destination,
 * where stops can be removed or reordered and another stop can be added.
 */
export function NavigationHud({
  etaSeconds,
  remainingDistanceMeters,
  destinationName,
  nextStop,
  upcomingStops,
  onExit,
  onAddStop,
  onSkipStop,
  onRemoveStop,
  onMoveStop,
  onExpandedChange,
}: NavigationHudProps) {
  const [expanded, setExpanded] = useState(false);
  const expandedRef = useRef(false);
  const expand = useSharedValue(0);

  const setExpansion = useCallback(
    (value: boolean) => {
      expandedRef.current = value;
      setExpanded(value);
      onExpandedChange?.(value);
      expand.value = withSpring(value ? 1 : 0, sheetTokens.spring);
    },
    [expand, onExpandedChange],
  );

  // Grabber gesture (replaces PanResponder): drag down collapses, drag up
  // expands, a tap toggles. Thresholds come from the shared sheet tokens.
  const expandGesture = useMemo(
    () =>
      Gesture.Pan().onEnd((event) => {
        if (event.translationY > sheetTokens.collapseDownPx) {
          runOnJS(setExpansion)(false);
        } else if (event.translationY < -sheetTokens.collapseUpPx) {
          runOnJS(setExpansion)(true);
        } else if (Math.abs(event.translationY) < 6) {
          runOnJS(setExpansion)(!expandedRef.current);
        }
      }),
    [setExpansion],
  );

  const sheetStyle = useAnimatedStyle(() => ({
    maxHeight: expand.value * SHEET_MAX_HEIGHT,
    marginBottom: expand.value * 8,
    opacity: expand.value,
  }));

  const handleAddStop = useCallback(() => {
    setExpansion(false);
    onAddStop();
  }, [onAddStop, setExpansion]);

  const stopIndices = upcomingStops.filter((s) => !s.isDestination).map((s) => s.waypointIndex);
  const firstStopIndex = stopIndices[0] ?? -1;
  const lastStopIndex = stopIndices[stopIndices.length - 1] ?? -1;

  const renderStopRow = (stop: UpcomingStop) => {
    if (stop.isDestination) {
      return (
        <View key="destination" style={styles.stopRow} testID="hud-destination">
          <View style={[styles.stopIcon, styles.destinationIcon]}>
            <Ionicons name="navigate" size={15} color="#0A84FF" />
          </View>
          <View style={styles.stopInfo}>
            <Text style={styles.stopName} numberOfLines={1}>
              {stop.name}
            </Text>
            <Text style={styles.stopEta}>{formatClock(stop.etaSeconds)} ETA · Destination</Text>
          </View>
        </View>
      );
    }

    const isFirst = stop.waypointIndex === firstStopIndex;
    const isLast = stop.waypointIndex === lastStopIndex;
    return (
      <View
        key={`stop-${stop.waypointIndex}`}
        style={styles.stopRow}
        testID={`hud-stop-${stop.waypointIndex}`}
      >
        <View style={[styles.stopIcon, styles.stopIconOrange]}>
          <Ionicons name="flag" size={14} color="#FF9500" />
        </View>
        <View style={styles.stopInfo}>
          <Text style={styles.stopName} numberOfLines={1}>
            {stop.name}
          </Text>
          <Text style={styles.stopEta}>{formatClock(stop.etaSeconds)} ETA</Text>
        </View>
        <View style={styles.stopActions}>
          <TouchableOpacity
            style={styles.stopAction}
            onPress={() => onMoveStop(stop.waypointIndex, -1)}
            disabled={isFirst}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Move ${stop.name} earlier`}
            accessibilityState={{ disabled: isFirst }}
          >
            <Ionicons
              name="chevron-up"
              size={20}
              color={isFirst ? 'rgba(255,255,255,0.25)' : '#fff'}
            />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.stopAction}
            onPress={() => onMoveStop(stop.waypointIndex, 1)}
            disabled={isLast}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Move ${stop.name} later`}
            accessibilityState={{ disabled: isLast }}
          >
            <Ionicons
              name="chevron-down"
              size={20}
              color={isLast ? 'rgba(255,255,255,0.25)' : '#fff'}
            />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.stopAction}
            onPress={() => onRemoveStop(stop.waypointIndex)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${stop.name}`}
          >
            <Ionicons name="remove-circle" size={22} color="#FF453A" />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <GlassView material="regular" colorScheme="dark" style={styles.card}>
      {/* Grabber — drag up/down or double-tap to toggle the stops sheet */}
      <GestureDetector gesture={expandGesture}>
        <View
          style={styles.handleZone}
          accessible
          accessibilityRole="button"
          accessibilityLabel={expanded ? 'Collapse stops' : 'Expand stops'}
          accessibilityHint="Drag up or double tap to show all destinations"
          onAccessibilityTap={() => setExpansion(!expandedRef.current)}
        >
          <View style={styles.handleBar} />
        </View>
      </GestureDetector>

      {/* Upcoming stops + destination */}
      <Animated.View
        style={[styles.sheet, sheetStyle]}
        pointerEvents={expanded ? 'auto' : 'none'}
        accessibilityElementsHidden={!expanded}
        importantForAccessibility={expanded ? 'auto' : 'no-hide-descendants'}
      >
        <ScrollView style={styles.stopList} contentContainerStyle={styles.stopListContent}>
          {upcomingStops.map(renderStopRow)}
        </ScrollView>
        <TouchableOpacity
          style={styles.addStopRow}
          onPress={handleAddStop}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Add another stop"
          accessibilityHint="Search for another stop along your route"
        >
          <Ionicons name="add" size={22} color="#0A84FF" />
          <Text style={styles.addStopText}>Add Stop</Text>
        </TouchableOpacity>
      </Animated.View>

      <EtaDisplay
        etaSeconds={etaSeconds}
        remainingDistanceMeters={remainingDistanceMeters}
        onExit={onExit}
        onAddDestination={handleAddStop}
        destinationName={destinationName}
        nextStop={nextStop}
        onSkipStop={onSkipStop}
      />
    </GlassView>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(28,28,45,0.72)',
    borderRadius: borderRadius.xxl,
    overflow: 'hidden',
    paddingTop: 6,
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 12,
  },
  handleZone: {
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handleBar: {
    width: 40,
    height: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  sheet: {
    backgroundColor: 'transparent',
    overflow: 'hidden',
    paddingTop: 4,
  },
  stopList: {
    maxHeight: LIST_MAX_HEIGHT,
  },
  stopListContent: {
    paddingHorizontal: spacing.md,
  },
  stopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  stopIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  stopIconOrange: {
    backgroundColor: 'rgba(255,149,0,0.18)',
  },
  destinationIcon: {
    backgroundColor: 'rgba(10,132,255,0.18)',
  },
  stopInfo: {
    flex: 1,
    marginRight: 8,
  },
  stopName: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 20,
  },
  stopEta: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 13,
    marginTop: 1,
  },
  stopActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  stopAction: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addStopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: 13,
  },
  addStopText: {
    color: '#0A84FF',
    fontSize: 16,
    fontWeight: '600',
  },
});
