import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { MapView } from '@/components/map/MapView';
import type { MapViewHandle } from '@/components/map/MapView';
import { NextTurnBanner, EtaDisplay, SpeedLimitSign, LaneGuidance } from '@/components/navigation';
import { AddDestinationPanel } from '@/components/navigation/AddDestinationPanel';
import { IncidentReportPanel } from '@/components/navigation/IncidentReportPanel';
import type { UnifiedSearchResult } from '@/services/search/unifiedSearch';
import { useNavigationStore } from '@/stores/navigationStore';
import { spacing, typography, borderRadius } from '@/constants/theme';
import { useTheme } from '@/contexts/ThemeContext';
import { decodePolyline } from '@/utils/polyline';
import { computeBearing } from '@/utils/routeSnap';
import { computeRoute } from '@/services/routing/routingService';
import {
  startTracking,
  processFix,
  getAnchor,
  getGpsSegmentIndex,
  getRouteCoords,
  advanceAlongRoute,
  distToIndex,
} from '@/services/navigation/trackingService';
import { useNavigationTrackingStore } from '@/stores/navigationTrackingStore';
import { useTrafficEta } from '@/hooks/useTrafficEta';
import { useNavigationTrafficRefresh } from '@/hooks/useNavigationTrafficRefresh';
import { useLiveActivity } from '@/hooks/useLiveActivity';
import { speakInstruction, stopNavigationSpeech } from '@/services/tts';
import { Ionicons } from '@expo/vector-icons';
import { GlassView } from '@/components/common/GlassView';
import * as Haptics from 'expo-haptics';

export default function NavigationScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const activeRoute = useNavigationStore((s) => s.activeRoute);
  const currentManeuver = useNavigationStore((s) => s.currentManeuver);
  const currentStepIndex = useNavigationStore((s) => s.currentStepIndex);
  const etaSeconds = useNavigationStore((s) => s.etaSeconds);
  const remainingDistanceMeters = useNavigationStore((s) => s.remainingDistanceMeters);
  const isNavigating = useNavigationStore((s) => s.isNavigating);
  const stopNavigation = useNavigationStore((s) => s.stopNavigation);
  const waypoints = useNavigationStore((s) => s.waypoints);
  const currentLegIndex = useNavigationStore((s) => s.currentLegIndex);
  const advanceLeg = useNavigationStore((s) => s.advanceLeg);
  const costing = useNavigationStore((s) => s.costing);
  const destination = useNavigationStore((s) => s.destination);
  const addWaypointAndReplaceRoute = useNavigationStore((s) => s.addWaypointAndReplaceRoute);

  // Keep the screen awake while actively navigating (like Apple/Google Maps)
  useEffect(() => {
    if (isNavigating) {
      activateKeepAwakeAsync('navigation');
    } else {
      deactivateKeepAwake('navigation');
    }
    return () => {
      deactivateKeepAwake('navigation');
    };
  }, [isNavigating]);

  // Track previous navigation state so we can detect when it ends
  const wasNavigating = useRef(false);
  useEffect(() => {
    if (wasNavigating.current && !isNavigating) {
      stopNavigationSpeech();
      router.replace('/(tabs)');
    }
    wasNavigating.current = isNavigating;
  }, [isNavigating, router]);

  // Recompute traffic-adjusted ETA when route or traffic data changes
  useTrafficEta();

  // Start/stop periodic traffic refresh based on navigation state
  useNavigationTrafficRefresh();

  // Manage iOS Live Activity (Dynamic Island) while navigating
  useLiveActivity();

  // Voice guidance: speak turn-by-turn instructions as maneuvers advance.
  // Skips the initial mount so we don't greet the user on navigation start;
  // speaks on every subsequent step change (including after reroutes).
  const prevStepIndexRef = useRef<number | null>(null);
  const hasSpokenInitialRef = useRef(false);
  useEffect(() => {
    if (!isNavigating || !currentManeuver) return;

    // On the very first render after navigation starts, record the index
    // without speaking (the user just saw the route and doesn't need an
    // immediate prompt). All subsequent step changes are spoken.
    if (!hasSpokenInitialRef.current) {
      prevStepIndexRef.current = currentStepIndex;
      hasSpokenInitialRef.current = true;
      return;
    }

    // Only speak when the step index actually changes.
    if (currentStepIndex !== prevStepIndexRef.current) {
      prevStepIndexRef.current = currentStepIndex;
      const text = currentManeuver.verbalPreTransition || currentManeuver.instruction;
      if (text.trim()) {
        speakInstruction(text);
      }
      // Haptic feedback at turn points — medium impact for turns, light for continues
      if (currentManeuver.type === 'destination') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }
    }
  }, [isNavigating, currentStepIndex, currentManeuver]);

  // Reset speech flag when navigation restarts.
  useEffect(() => {
    if (!isNavigating) {
      hasSpokenInitialRef.current = false;
      prevStepIndexRef.current = null;
    }
  }, [isNavigating]);

  // Live nav position/bearing/distance-to-turn live in a shared store so the
  // headless background location task can keep them updated while this UI is
  // backgrounded (see trackingService).
  const navPosition = useNavigationTrackingStore((s) => s.navPosition);
  const navBearing = useNavigationTrackingStore((s) => s.navBearing);
  const distanceToTurn = useNavigationTrackingStore((s) => s.distanceToTurn);
  // True while the managed background location session drives fixes; when
  // false (or until it starts) the screen runs its own foreground watcher.
  const backgroundSessionActive = useNavigationTrackingStore((s) => s.backgroundSessionActive);

  // Camera follow state — breaks when user pans/zooms, restored by re-center button
  const [followCamera, setFollowCamera] = useState(true);
  const [showAddDestination, setShowAddDestination] = useState(false);
  const [showIncidentReport, setShowIncidentReport] = useState(false);
  const mapRef = useRef<MapViewHandle>(null);
  const navPositionRef = useRef<[number, number] | null>(null);
  navPositionRef.current = navPosition;

  const handleFollowCameraChange = useCallback((following: boolean) => {
    setFollowCamera(following);
  }, []);

  const handleRecenter = useCallback(() => {
    setFollowCamera(true);
    const pos = navPositionRef.current;
    if (pos && mapRef.current) {
      mapRef.current.flyTo(pos[1], pos[0], 17);
    }
  }, []);

  const handleOpenAddDestination = useCallback(() => {
    setShowAddDestination(true);
  }, []);

  const handleCloseAddDestination = useCallback(() => {
    setShowAddDestination(false);
  }, []);

  const handleSelectDestination = useCallback(
    async (result: UnifiedSearchResult) => {
      const pos = navPositionRef.current;
      if (!pos || !destination) {
        setShowAddDestination(false);
        return;
      }

      // Build new waypoint list from current position
      // pending waypoints = waypoints from currentLegIndex onwards
      const pendingWaypoints = waypoints.slice(currentLegIndex);

      // Insert new destination after the current target (index 1), or append if empty
      const newWaypoint = { lat: result.lat, lng: result.lng, name: result.name };
      if (pendingWaypoints.length > 0) {
        pendingWaypoints.splice(1, 0, newWaypoint);
      } else {
        pendingWaypoints.push(newWaypoint);
      }

      // Compute new route: currentPos -> pendingWaypoints -> original destination
      const routeWaypoints = [
        { lat: pos[1], lng: pos[0] },
        ...pendingWaypoints,
        { lat: destination.lat, lng: destination.lng },
      ];

      try {
        const routes = await computeRoute(routeWaypoints, costing);
        if (routes.length > 0) {
          addWaypointAndReplaceRoute(routes[0], pendingWaypoints);
        }
      } catch {
        // Silently fail — user can try again
      }

      setShowAddDestination(false);
    },
    [waypoints, currentLegIndex, destination, costing, addWaypointAndReplaceRoute],
  );

  // Initialize navPosition from the route start so the chevron appears immediately
  useEffect(() => {
    if (isNavigating && activeRoute && !navPosition) {
      const coords = decodePolyline(activeRoute.geometry);
      if (coords.length >= 2) {
        const tracking = useNavigationTrackingStore.getState();
        tracking.setNavPosition(coords[0]);
        tracking.setNavBearing(computeBearing(coords[0], coords[1]));
      }
    }
  }, [isNavigating, activeRoute, navPosition]);

  // Low-pass filtered bearing so turns animate smoothly rather than snapping.
  const smoothBearingRef = useRef(0);
  const interpolationRafRef = useRef<number | null>(null);

  // Live GPS tracking: the shared trackingService pipeline (trackingService)
  // processes every fix — foreground watcher or headless background task —
  // updating navigationStore + navigationTrackingStore. This loop only does
  // presentation work: dead-reckoning interpolation between GPS ticks at
  // ~60fps for Google/Apple-Maps-style gliding.
  useEffect(() => {
    if (!isNavigating || !activeRoute) return;

    startTracking(activeRoute);

    const coords = [...getRouteCoords()];
    if (coords.length < 2) return;

    const allManeuvers = activeRoute.legs.flatMap((l) => l.maneuvers);
    let subscription: Location.LocationSubscription | null = null;

    // Helper: shortest signed angle delta in [-180, 180].
    const shortestAngleDelta = (from: number, to: number) => ((to - from + 540) % 360) - 180;

    // Helper: interpolate between two angles along the shortest path.
    const interpolateBearing = (from: number, to: number, t: number) =>
      (from + shortestAngleDelta(from, to) * t + 360) % 360;

    // Bearing interpolation state.
    const BEARING_DURATION_MS = 200;
    let bearingTarget = smoothBearingRef.current;
    let bearingStart = smoothBearingRef.current;
    let bearingStartTime = performance.now();

    const interpolate = (now: number) => {
      const anchor = getAnchor();
      const trackingStore = useNavigationTrackingStore.getState();
      if (anchor) {
        const elapsed = Math.min((now - anchor.time) / 1000, 2.0); // cap at 2s

        let curPos: [number, number];
        let curSegIdx: number;

        if (anchor.speedMps > 0.3 && elapsed > 0) {
          [curPos, curSegIdx] = advanceAlongRoute(
            anchor.pos,
            anchor.segIdx,
            anchor.speedMps * elapsed,
          );
          // Compute the route bearing and smoothly interpolate toward it.
          // Uses shortest-path interpolation over BEARING_DURATION_MS so
          // turns animate naturally without a visible snap.
          // Only restart interpolation when the target changes meaningfully
          // (>0.5°) to avoid micro-restarts from floating-point drift.
          const rawBearing = computeBearing(
            coords[curSegIdx],
            coords[Math.min(curSegIdx + 1, coords.length - 1)],
          );
          if (Math.abs(shortestAngleDelta(bearingTarget, rawBearing)) > 0.5) {
            bearingStart = smoothBearingRef.current;
            bearingTarget = rawBearing;
            bearingStartTime = now;
          }
          const t = Math.min((now - bearingStartTime) / BEARING_DURATION_MS, 1.0);
          smoothBearingRef.current = interpolateBearing(bearingStart, bearingTarget, t);
          trackingStore.setNavPosition(curPos);
          trackingStore.setNavBearing(smoothBearingRef.current);
        } else {
          // Stationary — hold at anchor position
          curPos = anchor.pos;
          curSegIdx = anchor.segIdx;
          trackingStore.setNavPosition(curPos);
        }

        // Advance maneuver step when the GPS-confirmed position crosses
        // the next step's shape boundary. Using the GPS-verified segment
        // index prevents the DR-extrapolated segment index, which can drift
        // ahead of the true position, from triggering premature step advances
        // when consecutive maneuvers have close beginShapeIndex values.
        const store = useNavigationStore.getState();
        const nextStepIdx = store.currentStepIndex + 1;
        if (
          nextStepIdx < allManeuvers.length &&
          getGpsSegmentIndex() >= allManeuvers[nextStepIdx].beginShapeIndex
        ) {
          store.advanceStep();
        }

        // Compute live remaining distance to the end of the current step so the
        // banner counts down continuously rather than showing a fixed value.
        const liveStepIndex = useNavigationStore.getState().currentStepIndex;
        const stepEndIdx = Math.min(
          allManeuvers[liveStepIndex]?.endShapeIndex ?? coords.length - 1,
          coords.length - 1,
        );
        trackingStore.setDistanceToTurn(distToIndex(curPos, curSegIdx, stepEndIdx));
      }
      interpolationRafRef.current = requestAnimationFrame(interpolate);
    };

    interpolationRafRef.current = requestAnimationFrame(interpolate);

    // Foreground fallback watcher: runs until/unless the managed background
    // location session takes over delivering fixes (both feed processFix).
    if (!backgroundSessionActive) {
      (async () => {
        subscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.BestForNavigation,
            distanceInterval: 5,
            timeInterval: 1000,
          },
          (location) => {
            processFix(location);
          },
        );
      })();
    }

    return () => {
      subscription?.remove();
      if (interpolationRafRef.current !== null) {
        cancelAnimationFrame(interpolationRafRef.current);
        interpolationRafRef.current = null;
      }
      smoothBearingRef.current = 0;
    };
  }, [isNavigating, activeRoute, backgroundSessionActive]);

  if (!isNavigating || !activeRoute) {
    return (
      <View style={[styles.empty, { paddingTop: insets.top }]}>
        <Text style={styles.emptyText}>No active navigation</Text>
        <Text style={styles.emptyHint}>Search for a destination and start a route</Text>
      </View>
    );
  }

  const allManeuvers = activeRoute.legs.flatMap((l) => l.maneuvers);
  const nextManeuver = allManeuvers[currentStepIndex + 1] ?? null;

  return (
    <View style={styles.container}>
      {/* Full-screen map — tilted + heading-up when navigating */}
      <MapView
        ref={mapRef}
        routeGeometry={activeRoute.geometry}
        navigationMode={isNavigating}
        navPosition={navPosition}
        navBearing={navBearing}
        followCamera={followCamera}
        onFollowCameraChange={handleFollowCameraChange}
      />

      {/* Turn banner + speed limit + lane guidance overlaid at top */}
      <View style={[styles.bannerContainer, { top: insets.top + spacing.sm }]}>
        <View style={styles.bannerRow}>
          <View style={styles.bannerFlex}>
            <NextTurnBanner
              maneuver={currentManeuver}
              nextManeuver={nextManeuver}
              distanceToTurnMeters={distanceToTurn ?? undefined}
            />
            {currentManeuver?.laneGuidance && (
              <LaneGuidance laneGuidance={currentManeuver.laneGuidance} />
            )}
          </View>
          {currentManeuver?.speedLimitMph != null && (
            <SpeedLimitSign speedLimitMph={currentManeuver.speedLimitMph} />
          )}
        </View>
      </View>

      {/* Floating bottom bar pinned above the safe area. */}
      <View style={[styles.etaContainer, { bottom: insets.bottom + spacing.md }]}>
        {/* Multi-stop: show next stop name */}
        {waypoints.length > 0 && currentLegIndex < waypoints.length && (
          <GlassView material="regular" style={styles.nextStopBanner}>
            <Ionicons name="flag-outline" size={14} color="#fff" />
            <Text style={styles.nextStopText} numberOfLines={1}>
              Next: {waypoints[currentLegIndex]?.name ?? `Stop ${currentLegIndex + 1}`}
            </Text>
            <TouchableOpacity
              onPress={advanceLeg}
              style={styles.skipStopBtn}
              activeOpacity={0.7}
              accessibilityLabel="Skip stop"
              accessibilityHint="Skip the next waypoint and continue to the following stop"
              accessibilityRole="button"
            >
              <Text style={styles.skipStopText}>Skip</Text>
            </TouchableOpacity>
          </GlassView>
        )}
        <EtaDisplay
          etaSeconds={etaSeconds}
          remainingDistanceMeters={remainingDistanceMeters}
          onExit={stopNavigation}
          onAddDestination={handleOpenAddDestination}
          destinationName={destination?.name}
        />
      </View>

      {/* Re-center button — shown when user has panned/zoomed away */}
      {!followCamera && (
        <Pressable
          style={({ pressed }) => [
            styles.recenterBtn,
            { bottom: insets.bottom + spacing.md + 100, opacity: pressed ? 0.85 : 1 },
          ]}
          onPress={handleRecenter}
          accessibilityLabel="Re-center map"
          accessibilityHint="Return the map view to your current location"
          accessibilityRole="button"
        >
          <GlassView material="regular" isInteractive style={styles.recenterBtnInner}>
            <Ionicons name="navigate" size={16} color="#fff" />
            <Text style={styles.recenterText}>Re-center</Text>
          </GlassView>
        </Pressable>
      )}

      {/* Report incident button */}
      <Pressable
        style={({ pressed }) => [
          styles.reportBtn,
          { bottom: insets.bottom + spacing.md + 100, opacity: pressed ? 0.85 : 1 },
        ]}
        onPress={() => setShowIncidentReport(true)}
        accessibilityLabel="Report incident"
        accessibilityHint="Report a traffic incident at your current location"
        accessibilityRole="button"
      >
        <GlassView material="regular" isInteractive style={styles.reportBtnInner}>
          <Ionicons name="alert-circle-outline" size={16} color="#fff" />
          <Text style={styles.reportText}>Report</Text>
        </GlassView>
      </Pressable>

      {/* Add destination search panel */}
      <AddDestinationPanel
        visible={showAddDestination}
        onClose={handleCloseAddDestination}
        onSelect={handleSelectDestination}
        searchCenter={
          navPosition ? { lat: navPosition[1], lng: navPosition[0] } : { lat: 0, lng: 0 }
        }
      />

      {/* Incident report panel */}
      <IncidentReportPanel
        visible={showIncidentReport}
        onClose={() => setShowIncidentReport(false)}
        position={navPosition ?? [0, 0]}
      />
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    container: { flex: 1 },
    bannerContainer: {
      position: 'absolute',
      left: spacing.md,
      right: spacing.md,
    },
    bannerRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
    },
    bannerFlex: {
      flex: 1,
    },
    etaContainer: {
      position: 'absolute',
      left: spacing.md,
      right: spacing.md,
    },
    empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
    emptyText: { ...typography.h3, color: colors.text, marginBottom: spacing.xs },
    emptyHint: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
    reportBtn: {
      position: 'absolute',
      left: spacing.md,
      zIndex: 10,
      borderRadius: 999,
      overflow: 'hidden',
      borderCurve: 'continuous',
    },
    reportBtnInner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 10,
      paddingHorizontal: 16,
      borderRadius: 999,
      overflow: 'hidden',
      borderCurve: 'continuous',
    },
    reportText: {
      color: '#fff',
      fontSize: 14,
      fontWeight: '600',
    },
    recenterBtn: {
      position: 'absolute',
      alignSelf: 'center',
      zIndex: 10,
      borderRadius: 999,
      overflow: 'hidden',
      borderCurve: 'continuous',
    },
    recenterBtnInner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 10,
      paddingHorizontal: 16,
      borderRadius: 999,
      overflow: 'hidden',
      borderCurve: 'continuous',
    },
    recenterText: {
      color: '#fff',
      fontSize: 14,
      fontWeight: '600',
    },
    nextStopBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginBottom: 6,
      paddingVertical: 8,
      paddingHorizontal: 14,
      borderRadius: borderRadius.md,
      overflow: 'hidden',
      borderCurve: 'continuous',
    },
    nextStopText: {
      flex: 1,
      color: '#fff',
      fontSize: 13,
      fontWeight: '500',
    },
    skipStopBtn: {
      paddingVertical: 2,
      paddingHorizontal: 8,
      borderRadius: 999,
      overflow: 'hidden',
      borderCurve: 'continuous',
    },
    skipStopText: {
      color: '#409CFF',
      fontSize: 13,
      fontWeight: '600',
    },
  });
