import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { EtaDisplay } from './EtaDisplay';
import type { NextStop, UpcomingStop } from '../../utils/navigationStops';
import { spacing, borderRadius } from '../../constants/theme';

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
  const expandAnim = useRef(new Animated.Value(0)).current;

  const setExpansion = useCallback(
    (value: boolean) => {
      expandedRef.current = value;
      setExpanded(value);
      onExpandedChange?.(value);
      Animated.spring(expandAnim, {
        toValue: value ? 1 : 0,
        useNativeDriver: false,
        tension: 80,
        friction: 12,
      }).start();
    },
    [expandAnim, onExpandedChange],
  );

  const setExpansionRef = useRef(setExpansion);
  useEffect(() => {
    setExpansionRef.current = setExpansion;
  }, [setExpansion]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 5,
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dy > 30) {
          setExpansionRef.current(false);
        } else if (gesture.dy < -20) {
          setExpansionRef.current(true);
        } else if (Math.abs(gesture.dy) < 6) {
          setExpansionRef.current(!expandedRef.current);
        }
      },
    }),
  ).current;

  const handleAddStop = useCallback(() => {
    setExpansion(false);
    onAddStop();
  }, [onAddStop, setExpansion]);

  const sheetHeight = expandAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, SHEET_MAX_HEIGHT],
  });
  const sheetSpacing = expandAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 8],
  });

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
    <View style={styles.card}>
      {/* Grabber — drag up/down or double-tap to toggle the stops sheet */}
      <View
        style={styles.handleZone}
        {...panResponder.panHandlers}
        accessible
        accessibilityRole="button"
        accessibilityLabel={expanded ? 'Collapse stops' : 'Expand stops'}
        accessibilityHint="Drag up or double tap to show all destinations"
        onAccessibilityTap={() => setExpansion(!expandedRef.current)}
      >
        <View style={styles.handleBar} />
      </View>

      {/* Upcoming stops + destination */}
      <Animated.View
        style={[
          styles.sheet,
          { maxHeight: sheetHeight, marginBottom: sheetSpacing, opacity: expandAnim },
        ]}
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
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(17,17,17,0.96)',
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
