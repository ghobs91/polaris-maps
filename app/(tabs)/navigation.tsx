import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useRouter } from 'expo-router';
import { MapView } from '@/components/map/MapView';
import { NextTurnBanner, EtaDisplay } from '@/components/navigation';
import { useNavigationStore } from '@/stores/navigationStore';
import { useMapStore } from '@/stores/mapStore';
import { spacing, typography } from '@/constants/theme';
import { useTheme } from '@/contexts/ThemeContext';
import { decodePolyline } from '@/utils/polyline';
import { useTrafficEta } from '@/hooks/useTrafficEta';
import { useNavigationTrafficRefresh } from '@/hooks/useNavigationTrafficRefresh';

/** Compute bearing (in degrees, 0=north, CW) between two [lng,lat] points */
function computeBearing(from: [number, number], to: [number, number]): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const dLng = toRad(to[0] - from[0]);
  const lat1 = toRad(from[1]);
  const lat2 = toRad(to[1]);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

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
  } = useNavigationStore();

  // Track previous navigation state so we can detect when it ends
  const wasNavigating = useRef(false);
  useEffect(() => {
    if (wasNavigating.current && !isNavigating) {
      router.replace('/(tabs)');
    }
    wasNavigating.current = isNavigating;
  }, [isNavigating, router]);

  const [isPreviewMode, setIsPreviewMode] = useState(false);

  // Recompute traffic-adjusted ETA when route or traffic data changes
  useTrafficEta();

  // Start/stop periodic traffic refresh based on navigation state
  useNavigationTrafficRefresh();
  const [navPosition, setNavPosition] = useState<[number, number] | null>(null);
  const [navBearing, setNavBearing] = useState(0);
  const previewRafRef = useRef<number | null>(null);
  const previewIndexRef = useRef(0);
  const previewStartTimeRef = useRef(0);

  const stopPreview = useCallback(() => {
    setIsPreviewMode(false);
    if (previewRafRef.current !== null) {
      cancelAnimationFrame(previewRafRef.current);
      previewRafRef.current = null;
    }
  }, []);

  const togglePreview = useCallback(() => {
    if (isPreviewMode) {
      stopPreview();
    } else {
      previewIndexRef.current = 0;
      setIsPreviewMode(true);
    }
  }, [isPreviewMode, stopPreview]);

  // Stop preview if navigation ends
  useEffect(() => {
    if (!isNavigating) stopPreview();
  }, [isNavigating, stopPreview]);

  // Preview simulation: advance at real-time speed based on each maneuver's duration,
  // which reflects the road's speed limit as computed by the routing engine.
  useEffect(() => {
    if (!isPreviewMode || !activeRoute) return;

    const coords = decodePolyline(activeRoute.geometry);
    if (coords.length === 0) return;

    const allManeuvers = activeRoute.legs.flatMap((l) => l.maneuvers);

    // Build a cumulative time table: cumulativeMs[i] = simulated ms from start to reach coords[i].
    // Each maneuver's durationSeconds is distributed evenly across its shape segments.
    const cumulativeMs: number[] = new Array(coords.length).fill(0);
    for (const maneuver of allManeuvers) {
      const numSegments = maneuver.endShapeIndex - maneuver.beginShapeIndex;
      if (numSegments <= 0) continue;
      const msPerSegment = (maneuver.durationSeconds * 1000) / numSegments;
      for (let i = maneuver.beginShapeIndex; i < maneuver.endShapeIndex; i++) {
        cumulativeMs[i + 1] = cumulativeMs[i] + msPerSegment;
      }
    }
    const totalMs = cumulativeMs[coords.length - 1];

    // Reset to start
    previewIndexRef.current = 0;
    previewStartTimeRef.current = performance.now();
    setNavPosition(coords[0]);
    setNavBearing(0);

    // Use requestAnimationFrame for smooth, continuous interpolation between points.
    const tick = (now: number) => {
      const elapsedMs = now - previewStartTimeRef.current;
      if (elapsedMs >= totalMs) {
        stopPreview();
        return;
      }

      // Binary search: find the segment [lo, lo+1] that straddles elapsedMs
      let lo = 0;
      let hi = coords.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (cumulativeMs[mid] <= elapsedMs) lo = mid;
        else hi = mid - 1;
      }

      // Interpolate between coords[lo] and coords[lo+1]
      const nextIdx = Math.min(lo + 1, coords.length - 1);
      const segStart = cumulativeMs[lo];
      const segEnd = cumulativeMs[nextIdx];
      const t = segEnd > segStart ? (elapsedMs - segStart) / (segEnd - segStart) : 0;
      const a = coords[lo];
      const b = coords[nextIdx];
      const pos: [number, number] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      const bearing = computeBearing(a, b);

      setNavPosition(pos);
      setNavBearing(bearing);

      // Advance maneuver step if we've crossed its beginShapeIndex
      if (lo !== previewIndexRef.current) {
        previewIndexRef.current = lo;
        const store = useNavigationStore.getState();
        const nextStep = store.currentStepIndex + 1;
        if (nextStep < allManeuvers.length && lo >= allManeuvers[nextStep].beginShapeIndex) {
          store.advanceStep();
        }
      }

      previewRafRef.current = requestAnimationFrame(tick);
    };

    previewRafRef.current = requestAnimationFrame(tick);

    return () => {
      if (previewRafRef.current !== null) cancelAnimationFrame(previewRafRef.current);
    };
  }, [isPreviewMode, activeRoute, stopPreview]);

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
        navigationMode={isPreviewMode || isNavigating}
        navPosition={navPosition}
        navBearing={navBearing}
      />

      {/* Turn banner overlaid at top */}
      <View style={[styles.bannerContainer, { top: insets.top + spacing.sm }]}>
        <NextTurnBanner maneuver={currentManeuver} nextManeuver={nextManeuver} />
      </View>

      {/* ETA / Exit bar — sits above the tab bar */}
      <View style={[styles.etaContainer, { bottom: tabBarHeight }]}>
        <EtaDisplay
          etaSeconds={etaSeconds}
          remainingDistanceMeters={remainingDistanceMeters}
          onExit={stopNavigation}
          onPreview={togglePreview}
          isPreviewMode={isPreviewMode}
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
