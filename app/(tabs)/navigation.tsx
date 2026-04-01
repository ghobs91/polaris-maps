import React, { useMemo, useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { MapView } from '@/components/map/MapView';
import { NextTurnBanner, EtaDisplay } from '@/components/navigation';
import { useNavigationStore } from '@/stores/navigationStore';
import { spacing, typography } from '@/constants/theme';
import { useTheme } from '@/contexts/ThemeContext';
import { decodePolyline } from '@/utils/polyline';
import {
  computeBearing,
  snapToRoute,
  computeRemainingMeters,
  haversineMeters,
  isOffRoute,
  OFF_ROUTE_THRESHOLD_METERS,
} from '@/utils/routeSnap';
import { reroute } from '@/services/routing/routingService';
import { useTrafficEta } from '@/hooks/useTrafficEta';
import { useNavigationTrafficRefresh } from '@/hooks/useNavigationTrafficRefresh';

export default function NavigationScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const {
    activeRoute,
    currentManeuver,
    currentStepIndex,
    etaSeconds,
    remainingDistanceMeters,
    isNavigating,
    stopNavigation,
    updateEta,
  } = useNavigationStore();

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
      router.replace('/(tabs)');
    }
    wasNavigating.current = isNavigating;
  }, [isNavigating, router]);

  // Recompute traffic-adjusted ETA when route or traffic data changes
  useTrafficEta();

  // Start/stop periodic traffic refresh based on navigation state
  useNavigationTrafficRefresh();
  const [navPosition, setNavPosition] = useState<[number, number] | null>(null);
  const [navBearing, setNavBearing] = useState(0);
  // Live remaining distance to the end of the current maneuver step.
  // Updated every animation frame so the banner counts down continuously.
  const [distanceToTurn, setDistanceToTurn] = useState<number | null>(null);

  // Initialize navPosition from the route start so the chevron appears immediately
  useEffect(() => {
    if (isNavigating && activeRoute && !navPosition) {
      const coords = decodePolyline(activeRoute.geometry);
      if (coords.length >= 2) {
        setNavPosition(coords[0]);
        setNavBearing(computeBearing(coords[0], coords[1]));
      }
    }
  }, [isNavigating, activeRoute]);

  // Counter for consecutive off-route GPS readings; triggers reroute after threshold.
  const offRouteCountRef = useRef(0);
  // Prevents overlapping reroute requests.
  const reroutingRef = useRef(false);

  // Dead-reckoning anchor: updated on every GPS callback.
  // pos/segIdx = snapped position on route; speedMps = estimated travel speed;
  // time = performance.now() timestamp when this anchor was set.
  const drAnchorRef = useRef<{
    pos: [number, number];
    segIdx: number;
    speedMps: number;
    time: number;
  } | null>(null);
  // Low-pass filtered bearing so turns animate smoothly rather than snapping.
  const smoothBearingRef = useRef(0);
  const interpolationRafRef = useRef<number | null>(null);

  // Live GPS tracking: watch position and snap to route during active navigation
  useEffect(() => {
    if (!isNavigating || !activeRoute) return;

    const coords = decodePolyline(activeRoute.geometry);
    if (coords.length < 2) return;

    const allManeuvers = activeRoute.legs.flatMap((l) => l.maneuvers);
    let subscription: Location.LocationSubscription | null = null;

    /**
     * Walk `distMeters` forward along the route polyline from startPos/startSegIdx.
     * Returns the projected [lng, lat] and the segment index it falls on.
     */
    const advanceAlongRoute = (
      startPos: [number, number],
      startSegIdx: number,
      distMeters: number,
    ): [[number, number], number] => {
      let remaining = distMeters;
      let pos = startPos;
      let segIdx = startSegIdx;
      while (remaining > 0 && segIdx < coords.length - 1) {
        const segEnd = coords[segIdx + 1];
        const distToEnd = haversineMeters(pos, segEnd);
        if (distToEnd <= remaining) {
          remaining -= distToEnd;
          pos = segEnd;
          segIdx++;
        } else {
          const t = remaining / distToEnd;
          pos = [pos[0] + (segEnd[0] - pos[0]) * t, pos[1] + (segEnd[1] - pos[1]) * t];
          remaining = 0;
        }
      }
      return [pos, segIdx];
    };

    // Dead-reckoning loop at ~60fps:
    // Each frame advances the displayed position along the route at the last
    // known speed, computed from the elapsed time since the GPS anchor.
    // This produces continuous, Google/Apple-Maps-style gliding between GPS ticks.
    const BEARING_ALPHA = 0.12; // low-pass weight for bearing smoothing

    // Distance from pos/segIdx to coords[targetIdx], walking the polyline.
    const distToIndex = (pos: [number, number], segIdx: number, targetIdx: number): number => {
      if (segIdx >= targetIdx) return 0;
      let d = haversineMeters(pos, coords[segIdx + 1]);
      for (let i = segIdx + 1; i < targetIdx; i++) d += haversineMeters(coords[i], coords[i + 1]);
      return d;
    };

    const interpolate = (now: number) => {
      const anchor = drAnchorRef.current;
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
          // Low-pass filter the bearing from the route direction
          const rawBearing = computeBearing(
            coords[curSegIdx],
            coords[Math.min(curSegIdx + 1, coords.length - 1)],
          );
          const delta = ((rawBearing - smoothBearingRef.current + 540) % 360) - 180;
          smoothBearingRef.current = (smoothBearingRef.current + delta * BEARING_ALPHA + 360) % 360;
          setNavPosition(curPos);
          setNavBearing(smoothBearingRef.current);
        } else {
          // Stationary — hold at anchor position
          curPos = anchor.pos;
          curSegIdx = anchor.segIdx;
          setNavPosition(curPos);
        }

        // Advance maneuver step as soon as DR crosses the next step's shape boundary.
        // This fires at 60fps so the banner updates instantly, not waiting for the
        // next GPS tick (which can lag up to 1s behind the smooth extrapolation).
        const store = useNavigationStore.getState();
        const nextStepIdx = store.currentStepIndex + 1;
        if (
          nextStepIdx < allManeuvers.length &&
          curSegIdx >= allManeuvers[nextStepIdx].beginShapeIndex
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
        setDistanceToTurn(distToIndex(curPos, curSegIdx, stepEndIdx));
      }
      interpolationRafRef.current = requestAnimationFrame(interpolate);
    };

    interpolationRafRef.current = requestAnimationFrame(interpolate);

    (async () => {
      subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          distanceInterval: 5,
          timeInterval: 1000,
        },
        (location) => {
          const gpsPos: [number, number] = [location.coords.longitude, location.coords.latitude];
          const {
            snapped,
            segmentIndex,
            distanceMeters: distFromRoute,
          } = snapToRoute(gpsPos, coords);
          const now = performance.now();

          // --- Off-route detection & rerouting ---
          if (distFromRoute > OFF_ROUTE_THRESHOLD_METERS) {
            offRouteCountRef.current++;
          } else {
            offRouteCountRef.current = 0;
          }

          const store = useNavigationStore.getState();

          if (
            isOffRoute(distFromRoute, offRouteCountRef.current) &&
            !reroutingRef.current &&
            store.destination
          ) {
            reroutingRef.current = true;
            store.setDeviated(true);
            store.setRerouting(true);

            const gpsBearing = location.coords.heading ?? 0;
            reroute(
              {
                lat: location.coords.latitude,
                lng: location.coords.longitude,
                bearing: gpsBearing,
              },
              { lat: store.destination.lat, lng: store.destination.lng },
              store.costing,
            )
              .then((newRoute) => {
                const navStore = useNavigationStore.getState();
                if (navStore.isNavigating) {
                  navStore.replaceRoute(newRoute);
                  // Reset DR anchor to start of the new route
                  const newCoords = decodePolyline(newRoute.geometry);
                  if (newCoords.length >= 2) {
                    drAnchorRef.current = {
                      pos: newCoords[0],
                      segIdx: 0,
                      speedMps: (location.coords.speed ?? -1) >= 0 ? location.coords.speed! : 0,
                      time: performance.now(),
                    };
                  }
                }
                offRouteCountRef.current = 0;
                reroutingRef.current = false;
              })
              .catch(() => {
                // Reroute failed (e.g., no connectivity) — clear rerouting flag
                // so it will retry on the next off-route GPS reading.
                useNavigationStore.getState().setRerouting(false);
                reroutingRef.current = false;
              });

            return; // Skip normal DR update while rerouting
          }

          // Prefer the GPS speed field; fall back to estimating from distance/time delta.
          let speedMps = (location.coords.speed ?? -1) >= 0 ? location.coords.speed! : 0;
          if (speedMps <= 0 && drAnchorRef.current) {
            const dt = (now - drAnchorRef.current.time) / 1000;
            if (dt > 0.1) {
              speedMps = haversineMeters(drAnchorRef.current.pos, snapped) / dt;
            }
          }
          // Clamp to reasonable road speed (0–55 m/s ≈ 200 km/h)
          speedMps = Math.min(Math.max(speedMps, 0), 55);

          // Never move the marker backwards. If the current dead-reckoning
          // projection is *ahead* of the GPS snapped position on the route,
          // keep the DR position as the new anchor and simply adopt the
          // GPS speed. This prevents the visible backward jump that occurs
          // when GPS latency/inaccuracy reports a position behind the smooth
          // extrapolation.
          const prevAnchor = drAnchorRef.current;
          if (prevAnchor && prevAnchor.speedMps > 0.3) {
            const elapsed = Math.min((now - prevAnchor.time) / 1000, 2.0);
            const [drPos, drSegIdx] = advanceAlongRoute(
              prevAnchor.pos,
              prevAnchor.segIdx,
              prevAnchor.speedMps * elapsed,
            );
            const drRemaining = computeRemainingMeters(drPos, drSegIdx, coords);
            const gpsRemaining = computeRemainingMeters(snapped, segmentIndex, coords);
            if (drRemaining < gpsRemaining) {
              // DR is ahead of GPS — anchor at DR position, update speed only
              drAnchorRef.current = { pos: drPos, segIdx: drSegIdx, speedMps, time: now };
            } else {
              drAnchorRef.current = { pos: snapped, segIdx: segmentIndex, speedMps, time: now };
            }
          } else {
            drAnchorRef.current = { pos: snapped, segIdx: segmentIndex, speedMps, time: now };
          }

          // Update remaining distance and ETA based on current GPS position
          const remainingMeters = computeRemainingMeters(snapped, segmentIndex, coords);
          const totalMeters = activeRoute.summary.distanceMeters;
          const totalSeconds = activeRoute.summary.durationSeconds;
          const progress = totalMeters > 0 ? remainingMeters / totalMeters : 0;
          updateEta(Math.round(progress * totalSeconds), remainingMeters);

          // Advance maneuver step if user has progressed past the next step's start shape index
          const nextStep = store.currentStepIndex + 1;
          if (
            nextStep < allManeuvers.length &&
            segmentIndex >= allManeuvers[nextStep].beginShapeIndex
          ) {
            store.advanceStep();
          }
        },
      );
    })();

    return () => {
      subscription?.remove();
      if (interpolationRafRef.current !== null) {
        cancelAnimationFrame(interpolationRafRef.current);
        interpolationRafRef.current = null;
      }
      drAnchorRef.current = null;
      offRouteCountRef.current = 0;
      reroutingRef.current = false;
    };
  }, [isNavigating, activeRoute]);

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
        routeGeometry={activeRoute.geometry}
        navigationMode={isNavigating}
        navPosition={navPosition}
        navBearing={navBearing}
      />

      {/* Turn banner overlaid at top */}
      <View style={[styles.bannerContainer, { top: insets.top + spacing.sm }]}>
        <NextTurnBanner
          maneuver={currentManeuver}
          nextManeuver={nextManeuver}
          distanceToTurnMeters={distanceToTurn ?? undefined}
        />
      </View>

      {/* ETA / Exit bar — sits above the tab bar */}
      <View style={[styles.etaContainer, { bottom: tabBarHeight }]}>
        <EtaDisplay
          etaSeconds={etaSeconds}
          remainingDistanceMeters={remainingDistanceMeters}
          onExit={stopNavigation}
        />
      </View>
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
    etaContainer: {
      position: 'absolute',
      left: 0,
      right: 0,
    },
    empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
    emptyText: { ...typography.h3, color: colors.text, marginBottom: spacing.xs },
    emptyHint: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  });
