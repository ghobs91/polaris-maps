import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { MapView } from '@/components/map/MapView';
import type { MapViewHandle } from '@/components/map/MapView';
import { NextTurnBanner, NavigationHud, SpeedLimitSign } from '@/components/navigation';
import { AddDestinationPanel } from '@/components/navigation/AddDestinationPanel';
import { IncidentReportPanel } from '@/components/navigation/IncidentReportPanel';
import { IncidentAheadBanner } from '@/components/navigation/IncidentAheadBanner';
import type { UnifiedSearchResult } from '@/services/search/unifiedSearch';
import { useNavigationStore, type Waypoint } from '@/stores/navigationStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { spacing, typography } from '@/constants/theme';
import { useTheme } from '@/contexts/ThemeContext';
import { decodePolyline } from '@/utils/polyline';
import { buildUpcomingStops, buildNextStop, moveStop, removeStop } from '@/utils/navigationStops';
import { computeBearing, angleDifferenceDeg } from '@/utils/routeSnap';
import { computeRoute } from '@/services/routing/routingService';
import { buildRouteAlternatives } from '@/services/routing/routeAlternatives';
import {
  ArrivalDetector,
  distanceToTargetMeters,
  targetForLeg,
} from '@/services/navigation/arrivalService';
import { navigationModeCapabilities, navigationModeForCosting } from '@/utils/navigationMode';
import { ArrivalSummary } from '@/components/navigation/ArrivalSummary';
import { CurrentSpeedBadge } from '@/components/navigation/CurrentSpeedBadge';
import { NavigationStepsList } from '@/components/navigation/NavigationStepsList';
import { CarPlayNavigationCompanion } from '@/components/navigation/CarPlayNavigationCompanion';
import { useCarPlayStore } from '@/stores/carPlayStore';
import { OverSpeedMonitor } from '@/services/navigation/speedAlerts';
import { formatDuration } from '@/utils/units';
import {
  startTracking,
  processFix,
  getAnchor,
  getGpsSegmentIndex,
  getRouteCoords,
  advanceAlongRoute,
  distToIndex,
  isWrongWayDriving,
  isOffRouteActive,
  getGpsCourse,
  getGpsSpeed,
  setTrackingRoutePreferences,
} from '@/services/navigation/trackingService';
import { useNavigationTrackingStore } from '@/stores/navigationTrackingStore';
import { useTrafficEta } from '@/hooks/useTrafficEta';
import { useNavigationTrafficRefresh } from '@/hooks/useNavigationTrafficRefresh';
import { useLiveActivity } from '@/hooks/useLiveActivity';
import {
  announceArrival,
  announceManeuver,
  announceNavigationStart,
  announceOffRoute,
  announceRerouted,
  repeatLastAnnouncement,
  stopNavigationSpeech,
} from '@/services/tts';
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
  // Automotive-only guidance widgets are hidden for walk/bike/transit modes.
  const modeCapabilities = navigationModeCapabilities(navigationModeForCosting(costing));
  const destination = useNavigationStore((s) => s.destination);
  const isRerouting = useNavigationStore((s) => s.isRerouting);
  const hasDeviated = useNavigationStore((s) => s.hasDeviated);
  const addWaypointAndReplaceRoute = useNavigationStore((s) => s.addWaypointAndReplaceRoute);
  const alternateRoutes = useNavigationStore((s) => s.alternateRoutes);
  const switchToAlternate = useNavigationStore((s) => s.switchToAlternate);
  const muted = useNavigationStore((s) => s.muted);
  const setMuted = useNavigationStore((s) => s.setMuted);
  const hasArrived = useNavigationStore((s) => s.hasArrived);
  const setArrived = useNavigationStore((s) => s.setArrived);
  const navigationAutoAdvanceLegs = useSettingsStore((s) => s.navigationAutoAdvanceLegs);
  const navigationAutoEnd = useSettingsStore((s) => s.navigationAutoEnd);
  // While CarPlay is attached the car screen drives the map; the phone becomes
  // the companion (step list + add-stop search), like Apple Maps.
  const carPlayConnected = useCarPlayStore((s) => s.connected);

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

  // Voice guidance: a single "starting navigation" prompt when the session
  // begins. Advance-distance prompts are driven by the live distance-to-turn
  // (see the ladder effect below).
  useEffect(() => {
    if (isNavigating) announceNavigationStart(destination?.name);
  }, [isNavigating, destination?.name]);

  // Haptic feedback at turn points — success at the destination, medium on turns.
  const prevStepIndexRef = useRef<number | null>(null);
  useEffect(() => {
    if (!isNavigating || !currentManeuver) return;
    if (prevStepIndexRef.current === currentStepIndex) return;
    prevStepIndexRef.current = currentStepIndex;
    if (currentManeuver.type === 'destination') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
  }, [isNavigating, currentStepIndex, currentManeuver]);

  useEffect(() => {
    if (!isNavigating) prevStepIndexRef.current = null;
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

  // Advance-distance voice prompt ladder, driven by the snapped distance-to-turn.
  useEffect(() => {
    if (!isNavigating || !currentManeuver || distanceToTurn == null) return;
    const instruction = currentManeuver.verbalPreTransition || currentManeuver.instruction;
    if (!instruction?.trim()) return;
    announceManeuver(
      `${currentStepIndex}:${currentManeuver.instruction ?? ''}`,
      distanceToTurn,
      instruction,
    );
  }, [isNavigating, currentStepIndex, currentManeuver, distanceToTurn]);

  // Spoken off-route / reroute-complete prompts on transition edges.
  const wasReroutingRef = useRef(false);
  useEffect(() => {
    if (!isNavigating) {
      wasReroutingRef.current = false;
      return;
    }
    if (isRerouting && !wasReroutingRef.current) {
      wasReroutingRef.current = true;
      announceOffRoute();
    } else if (!isRerouting && wasReroutingRef.current) {
      wasReroutingRef.current = false;
      announceRerouted();
    }
  }, [isNavigating, isRerouting]);

  // Reset arrival trackers when a navigation session starts or ends.
  useEffect(() => {
    if (isNavigating) {
      startedAtRef.current = Date.now();
      waypointArrivalRef.current.reset();
      destinationArrivalRef.current.reset();
      setShowArrival(false);
    } else {
      setShowArrival(false);
      if (arrivalTimeoutRef.current) {
        clearTimeout(arrivalTimeoutRef.current);
        arrivalTimeoutRef.current = null;
      }
    }
  }, [isNavigating]);

  useEffect(
    () => () => {
      if (arrivalTimeoutRef.current) clearTimeout(arrivalTimeoutRef.current);
    },
    [],
  );

  // Arrival detection: intermediate waypoints advance (or prompt), and the
  // final destination declares arrival, announces it, and optionally ends.
  useEffect(() => {
    if (!isNavigating || !navPosition) return;

    const onFinalLeg = currentLegIndex >= waypoints.length;
    if (onFinalLeg) {
      if (!destination || hasArrived) return;
      const arrived = destinationArrivalRef.current.update({
        distanceToTargetMeters: distanceToTargetMeters(navPosition, destination),
        remainingMetersToTarget: remainingDistanceMeters,
      });
      if (!arrived) return;

      setArrived(true);
      setShowArrival(true);
      announceArrival(destination.name);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (navigationAutoEnd) {
        if (arrivalTimeoutRef.current) clearTimeout(arrivalTimeoutRef.current);
        arrivalTimeoutRef.current = setTimeout(() => stopNavigation(), 8000);
      }
      return;
    }

    const target = targetForLeg(waypoints, destination, currentLegIndex);
    if (!target) return;
    const reachedWaypoint = waypointArrivalRef.current.update({
      distanceToTargetMeters: distanceToTargetMeters(navPosition, target),
      remainingMetersToTarget: null,
    });
    if (!reachedWaypoint) return;

    waypointArrivalRef.current.reset();
    if (navigationAutoAdvanceLegs) advanceLeg();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [
    isNavigating,
    navPosition,
    currentLegIndex,
    waypoints,
    destination,
    remainingDistanceMeters,
    hasArrived,
    navigationAutoAdvanceLegs,
    navigationAutoEnd,
    advanceLeg,
    setArrived,
    stopNavigation,
  ]);

  // Current speed + over-speed alert (driving only), sampled once a second.
  useEffect(() => {
    if (!isNavigating || !modeCapabilities.speedometer) {
      setCurrentSpeedMph(null);
      setIsOverSpeed(false);
      overSpeedRef.current.reset();
      wasOverSpeedRef.current = false;
      return;
    }
    const tick = () => {
      const mps = getGpsSpeed();
      const mph = Number.isFinite(mps) ? mps * 2.23694 : 0;
      setCurrentSpeedMph(mph >= 1 ? mph : null);
      const limit = useNavigationStore.getState().currentManeuver?.speedLimitMph ?? null;
      const over = overSpeedRef.current.update(mph, limit);
      if (over && !wasOverSpeedRef.current) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      }
      wasOverSpeedRef.current = over;
      setIsOverSpeed(over);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [isNavigating, modeCapabilities.speedometer]);

  // Camera follow state — breaks when user pans/zooms, restored by re-center button
  const [followCamera, setFollowCamera] = useState(true);
  const [showAddDestination, setShowAddDestination] = useState(false);
  const [showIncidentReport, setShowIncidentReport] = useState(false);
  const [hudExpanded, setHudExpanded] = useState(false);
  const [showArrival, setShowArrival] = useState(false);
  const [showSteps, setShowSteps] = useState(false);
  const [currentSpeedMph, setCurrentSpeedMph] = useState<number | null>(null);
  const [isOverSpeed, setIsOverSpeed] = useState(false);
  const overSpeedRef = useRef(new OverSpeedMonitor());
  const wasOverSpeedRef = useRef(false);
  const waypointArrivalRef = useRef(new ArrivalDetector());
  const destinationArrivalRef = useRef(new ArrivalDetector());
  const startedAtRef = useRef<number | null>(null);
  const arrivalTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  // Search submitted in the add-stop panel: release camera follow so the
  // route-overview fit isn't yanked back to the chevron on the next GPS tick.
  // The Re-center button appears so the user can resume follow mode.
  const handleShowSearchResultsOnMap = useCallback(() => {
    setFollowCamera(false);
  }, []);

  // Recompute the route from the live position through the given pending stops
  // to the destination, then swap it in. Shared by add/remove/reorder actions.
  const rerouteFromStops = useCallback(
    async (pending: Waypoint[]) => {
      const pos = navPositionRef.current;
      if (!pos || !destination) return;
      const routeWaypoints = [
        { lat: pos[1], lng: pos[0] },
        ...pending,
        { lat: destination.lat, lng: destination.lng },
      ];
      try {
        const prefs = useSettingsStore.getState().routePreferences;
        const routes = await computeRoute(routeWaypoints, costing, {
          avoidTolls: prefs.avoidTolls,
          avoidHighways: prefs.avoidHighways,
          avoidFerries: prefs.avoidFerries,
        });
        if (routes.length > 0) {
          addWaypointAndReplaceRoute(routes[0], pending);
        }
      } catch {
        // Keep the existing route when recomputing fails
      }
    },
    [destination, costing, addWaypointAndReplaceRoute],
  );

  const handleSelectDestination = useCallback(
    async (result: UnifiedSearchResult) => {
      // Insert the new stop after the current target (index 1), or append if none
      const pendingWaypoints = waypoints.slice(currentLegIndex);
      const newWaypoint = { lat: result.lat, lng: result.lng, name: result.name };
      if (pendingWaypoints.length > 0) {
        pendingWaypoints.splice(1, 0, newWaypoint);
      } else {
        pendingWaypoints.push(newWaypoint);
      }

      await rerouteFromStops(pendingWaypoints);
      setShowAddDestination(false);
    },
    [waypoints, currentLegIndex, rerouteFromStops],
  );

  const handleRemoveStop = useCallback(
    (waypointIndex: number) => {
      const pending = waypoints.slice(currentLegIndex);
      const offset = waypointIndex - currentLegIndex;
      if (offset < 0 || offset >= pending.length) return;
      void rerouteFromStops(removeStop(pending, offset));
    },
    [waypoints, currentLegIndex, rerouteFromStops],
  );

  const handleMoveStop = useCallback(
    (waypointIndex: number, direction: -1 | 1) => {
      const pending = waypoints.slice(currentLegIndex);
      const offset = waypointIndex - currentLegIndex;
      if (offset < 0 || offset >= pending.length) return;
      const reordered = moveStop(pending, offset, direction);
      if (reordered === pending) return;
      void rerouteFromStops(reordered);
    },
    [waypoints, currentLegIndex, rerouteFromStops],
  );

  const upcomingStops = useMemo(
    () => buildUpcomingStops(activeRoute, waypoints, currentLegIndex, destination),
    [activeRoute, waypoints, currentLegIndex, destination],
  );

  const nextStop = useMemo(
    () => buildNextStop(activeRoute, waypoints, currentLegIndex, remainingDistanceMeters),
    [activeRoute, waypoints, currentLegIndex, remainingDistanceMeters],
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

  // Rounded grid cell (~11 m) so the add-stop panel doesn't see a new search
  // center object on every GPS tick (it would restart detour math endlessly).
  // The string is referentially stable until the user moves to a new cell.
  const searchCenterCell = navPosition
    ? `${Math.round(navPosition[1] * 1e4)},${Math.round(navPosition[0] * 1e4)}`
    : 'none';
  const searchCenter = useMemo(() => {
    if (searchCenterCell === 'none') return { lat: 0, lng: 0 };
    const [latE4, lngE4] = searchCenterCell.split(',').map(Number);
    return { lat: latE4 / 1e4, lng: lngE4 / 1e4 };
  }, [searchCenterCell]);

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

    setTrackingRoutePreferences(useSettingsStore.getState().routePreferences);
    startTracking(activeRoute);

    if (getRouteCoords().length < 2) return;

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
      // Read the tracked geometry live every frame: after a reroute the
      // tracker adopts the new route (see trackingService) while this
      // closure would otherwise keep gliding along the old polyline and
      // immediately report off-route again (reroute loop).
      const coords = getRouteCoords();
      if (anchor && coords.length >= 2) {
        const elapsed = Math.min((now - anchor.time) / 1000, 2.0); // cap at 2s

        let curPos: [number, number];
        let curSegIdx: number;

        // While off-route the anchor already holds LIVE GPS (see
        // trackingService): never project it forward along the stale route —
        // that glides the puck down the original road while the car drives
        // away and feeds the rerouter a stale origin.
        const offRoute = isOffRouteActive();
        const deviated = useNavigationStore.getState().hasDeviated;
        const freezeForOffRoute = offRoute || deviated;

        if (anchor.speedMps > 0.3 && elapsed > 0 && !freezeForOffRoute) {
          // When driving the wrong way the route bearing points opposite the
          // car: point the puck along the real GPS course and hold the
          // GPS-snapped position instead of gliding forward along the route
          // (which reads as driving backwards).
          const gpsCourse = getGpsCourse();
          const routeBearingGuess = computeBearing(
            coords[anchor.segIdx],
            coords[Math.min(anchor.segIdx + 1, coords.length - 1)],
          );
          const gpsDisagrees =
            gpsCourse != null &&
            (isWrongWayDriving() || angleDifferenceDeg(routeBearingGuess, gpsCourse) > 90);
          if (gpsDisagrees && gpsCourse != null) {
            curPos = anchor.pos;
            curSegIdx = anchor.segIdx;
            if (Math.abs(shortestAngleDelta(bearingTarget, gpsCourse)) > 0.5) {
              bearingStart = smoothBearingRef.current;
              bearingTarget = gpsCourse;
              bearingStartTime = now;
            }
          } else {
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
          }
          const t = Math.min((now - bearingStartTime) / BEARING_DURATION_MS, 1.0);
          smoothBearingRef.current = interpolateBearing(bearingStart, bearingTarget, t);
          trackingStore.setNavPosition(curPos);
          trackingStore.setNavBearing(smoothBearingRef.current);
        } else {
          // Stationary, or frozen while off-route — hold at anchor position
          // (live GPS when deviated). Point the puck along the real GPS
          // course when moving so it doesn't keep the old route bearing.
          curPos = anchor.pos;
          curSegIdx = anchor.segIdx;
          if (freezeForOffRoute) {
            const gpsCourse = getGpsCourse();
            if (gpsCourse != null) {
              if (Math.abs(shortestAngleDelta(bearingTarget, gpsCourse)) > 0.5) {
                bearingStart = smoothBearingRef.current;
                bearingTarget = gpsCourse;
                bearingStartTime = now;
              }
              const t = Math.min((now - bearingStartTime) / BEARING_DURATION_MS, 1.0);
              smoothBearingRef.current = interpolateBearing(bearingStart, bearingTarget, t);
              trackingStore.setNavBearing(smoothBearingRef.current);
            }
          }
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
        <Text style={styles.emptyHint}>
          Search for a destination and start a route. Driving routes can combine with transit via
          park-and-ride.
        </Text>
      </View>
    );
  }

  const allManeuvers = activeRoute.legs.flatMap((l) => l.maneuvers);
  const nextManeuver = allManeuvers[currentStepIndex + 1] ?? null;

  // CarPlay companion: the car shows the map, so the phone shows the step list
  // and an add-stop search bar instead of duplicating the map HUD.
  if (isNavigating && carPlayConnected) {
    return (
      <View style={styles.container}>
        <CarPlayNavigationCompanion
          route={activeRoute}
          currentStepIndex={currentStepIndex}
          etaSeconds={etaSeconds}
          remainingDistanceMeters={remainingDistanceMeters}
          destinationName={destination?.name}
          onAddStop={handleOpenAddDestination}
          onEnd={stopNavigation}
        />

        <AddDestinationPanel
          visible={showAddDestination}
          onClose={handleCloseAddDestination}
          onSelect={handleSelectDestination}
          onShowOnMap={handleShowSearchResultsOnMap}
          searchCenter={searchCenter}
        />

        <IncidentReportPanel
          visible={showIncidentReport}
          onClose={() => setShowIncidentReport(false)}
          position={navPosition ?? [0, 0]}
        />

        {showArrival && destination && (
          <ArrivalSummary
            destinationName={destination.name}
            elapsedSeconds={
              startedAtRef.current ? Math.floor((Date.now() - startedAtRef.current) / 1000) : 0
            }
            distanceMeters={activeRoute?.summary.distanceMeters ?? 0}
            onDismiss={() => {
              setShowArrival(false);
              stopNavigation();
            }}
          />
        )}
      </View>
    );
  }

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
        destination={destination}
      />

      {/* Turn banner + speed limit + lane guidance overlaid at top */}
      <View style={[styles.bannerContainer, { top: insets.top + spacing.sm }]}>
        {(isRerouting || hasDeviated) && (
          <View
            style={styles.rerouteBanner}
            accessibilityRole="alert"
            accessibilityLabel={isRerouting ? 'Rerouting' : 'Off route, rerouting'}
          >
            <Text style={styles.rerouteText}>
              {isRerouting ? 'Rerouting…' : 'Off route — rerouting…'}
            </Text>
            <Text style={styles.rerouteSub}>Using live GPS · auto-reroutes</Text>
          </View>
        )}
        <IncidentAheadBanner />

        {alternateRoutes.length > 0 && (
          <View style={styles.alternateRow}>
            {buildRouteAlternatives(activeRoute, alternateRoutes).map((option, idx) => {
              if (option.route === activeRoute) return null;
              return (
                <Pressable
                  key={`${idx}-${option.durationSeconds}`}
                  style={({ pressed }) => [styles.alternateChip, { opacity: pressed ? 0.8 : 1 }]}
                  onPress={() => {
                    switchToAlternate(option.route);
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Switch to alternate route, ${formatDuration(option.durationSeconds)}${
                    option.delaySeconds > 0 ? `, ${formatDuration(option.delaySeconds)} slower` : ''
                  }`}
                >
                  <Ionicons name="git-branch-outline" size={14} color="#fff" />
                  <Text style={styles.alternateChipText}>
                    {formatDuration(option.durationSeconds)}
                    {option.delaySeconds > 0 ? ` (+${formatDuration(option.delaySeconds)})` : ''}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
        <View style={styles.bannerRow}>
          <View style={styles.bannerFlex}>
            <NextTurnBanner
              maneuver={currentManeuver}
              nextManeuver={nextManeuver}
              distanceToTurnMeters={distanceToTurn ?? undefined}
              laneGuidance={
                modeCapabilities.laneGuidance ? currentManeuver?.laneGuidance : undefined
              }
            />
          </View>
          {modeCapabilities.speedometer && (
            <CurrentSpeedBadge speedMph={currentSpeedMph} over={isOverSpeed} />
          )}
          {modeCapabilities.speedLimit && currentManeuver?.speedLimitMph != null && (
            <SpeedLimitSign speedLimitMph={currentManeuver.speedLimitMph} />
          )}
        </View>
      </View>

      {/* Expandable bottom HUD pinned above the safe area. */}
      <View style={[styles.etaContainer, { bottom: insets.bottom + spacing.md }]}>
        <NavigationHud
          etaSeconds={etaSeconds}
          remainingDistanceMeters={remainingDistanceMeters}
          destinationName={destination?.name}
          nextStop={nextStop}
          upcomingStops={upcomingStops}
          onExit={stopNavigation}
          onAddStop={handleOpenAddDestination}
          onSkipStop={advanceLeg}
          onRemoveStop={handleRemoveStop}
          onMoveStop={handleMoveStop}
          onExpandedChange={setHudExpanded}
        />
      </View>

      {/* Right-side hovering action stack — hidden while the stops sheet is
          expanded. Re-center appears below Report when the camera is unfollowed. */}
      {!hudExpanded && (
        <View
          style={[styles.rightActions, { bottom: insets.bottom + spacing.md + 110 }]}
          pointerEvents="box-none"
        >
          <Pressable
            style={({ pressed }) => [styles.actionFab, { opacity: pressed ? 0.85 : 1 }]}
            onPress={() => setMuted(!muted)}
            accessibilityLabel={muted ? 'Unmute voice guidance' : 'Mute voice guidance'}
            accessibilityRole="button"
          >
            <GlassView material="regular" isInteractive style={styles.actionFabInner}>
              <Ionicons name={muted ? 'volume-mute' : 'volume-high'} size={22} color="#fff" />
            </GlassView>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.actionFab, { opacity: pressed ? 0.85 : 1 }]}
            onPress={() => repeatLastAnnouncement()}
            accessibilityLabel="Repeat last instruction"
            accessibilityRole="button"
          >
            <GlassView material="regular" isInteractive style={styles.actionFabInner}>
              <Ionicons name="refresh" size={22} color="#fff" />
            </GlassView>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.actionFab, { opacity: pressed ? 0.85 : 1 }]}
            onPress={() => setShowSteps(true)}
            accessibilityLabel="Show steps"
            accessibilityHint="Show the full list of directions for this route"
            accessibilityRole="button"
          >
            <GlassView material="regular" isInteractive style={styles.actionFabInner}>
              <Ionicons name="list" size={22} color="#fff" />
            </GlassView>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.actionFab, { opacity: pressed ? 0.85 : 1 }]}
            onPress={() => setShowIncidentReport(true)}
            accessibilityLabel="Report incident"
            accessibilityHint="Report a traffic incident at your current location"
            accessibilityRole="button"
          >
            <GlassView material="regular" isInteractive style={styles.actionFabInner}>
              <Ionicons name="alert-circle-outline" size={22} color="#fff" />
            </GlassView>
          </Pressable>
          {!followCamera && (
            <Pressable
              style={({ pressed }) => [styles.actionFab, { opacity: pressed ? 0.85 : 1 }]}
              onPress={handleRecenter}
              accessibilityLabel="Re-center map"
              accessibilityHint="Return the map view to your current location"
              accessibilityRole="button"
            >
              <GlassView material="regular" isInteractive style={styles.actionFabInner}>
                <Ionicons name="navigate" size={22} color="#fff" />
              </GlassView>
            </Pressable>
          )}
        </View>
      )}

      {/* Add destination search panel */}
      <AddDestinationPanel
        visible={showAddDestination}
        onClose={handleCloseAddDestination}
        onSelect={handleSelectDestination}
        onShowOnMap={handleShowSearchResultsOnMap}
        searchCenter={searchCenter}
      />

      {/* Incident report panel */}
      <IncidentReportPanel
        visible={showIncidentReport}
        onClose={() => setShowIncidentReport(false)}
        position={navPosition ?? [0, 0]}
      />

      {showArrival && destination && (
        <ArrivalSummary
          destinationName={destination.name}
          elapsedSeconds={
            startedAtRef.current ? Math.floor((Date.now() - startedAtRef.current) / 1000) : 0
          }
          distanceMeters={activeRoute?.summary.distanceMeters ?? 0}
          onDismiss={() => {
            setShowArrival(false);
            stopNavigation();
          }}
        />
      )}

      <NavigationStepsList
        visible={showSteps}
        route={activeRoute}
        currentStepIndex={currentStepIndex}
        onClose={() => setShowSteps(false)}
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
    alternateRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.xs,
      marginBottom: 8,
    },
    alternateChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: 'rgba(142,142,147,0.9)',
      borderRadius: 12,
      paddingVertical: 4,
      paddingHorizontal: 10,
    },
    alternateChipText: {
      color: '#fff',
      fontSize: 12,
      fontWeight: '600',
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
    rightActions: {
      position: 'absolute',
      right: spacing.md,
      zIndex: 10,
      flexDirection: 'column',
      alignItems: 'center',
      gap: 12,
    },
    actionFab: {
      borderRadius: 999,
      overflow: 'hidden',
      borderCurve: 'continuous',
    },
    actionFabInner: {
      width: 52,
      height: 52,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 26,
      overflow: 'hidden',
      borderCurve: 'continuous',
    },
    rerouteBanner: {
      backgroundColor: 'rgba(64,156,255,0.95)',
      borderRadius: 12,
      paddingVertical: 8,
      paddingHorizontal: 12,
      marginBottom: 8,
    },
    rerouteText: { color: '#fff', fontSize: 14, fontWeight: '700' },
    rerouteSub: { color: 'rgba(255,255,255,0.85)', fontSize: 11, marginTop: 1 },
  });
