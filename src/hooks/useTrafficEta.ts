import { useEffect, useRef } from 'react';
import { useNavigationStore } from '../stores/navigationStore';
import { useTrafficStore } from '../stores/trafficStore';
import { extractRouteSegments, calculateTrafficETA } from '../utils/etaCalculator';
import { fetchRouteTrafficEta } from '../services/traffic/tomtomRouteEta';

const ETA_REFRESH_INTERVAL_MS = 60_000;
/** Minimum fraction of route segments that must match traffic data before the
 *  local computation is trusted as the primary ETA source. Below this threshold
 *  the TomTom API is used as a fallback. */
const MIN_MATCH_RATIO_FOR_LOCAL = 0.1;

/**
 * Periodically computes a traffic-adjusted ETA for the active route using
 * a segment-by-segment approach:
 *
 * 1. Decodes the route polyline into micro-segments (one per coordinate pair),
 *    assigning each segment a free-flow speed derived from the road class
 *    inferred from Valhalla maneuvers (motorway=70, secondary=30, etc.).
 *
 * 2. For each micro-segment, looks up the nearest traffic segment within 50m
 *    from the merged TomTom + P2P traffic data. Uses the traffic segment's
 *    current speed for the live estimate and its free-flow speed for the baseline.
 *
 * 3. Sums travel times across all segments to produce the total ETA.
 *
 * When local traffic data coverage is too sparse (fewer than 10% of segments
 * matched), the TomTom Calculate Route API is used as a supplementary source.
 *
 * Refreshes every 60 seconds during active navigation.
 */
export function useTrafficEta(): void {
  const activeRoute = useNavigationStore((s) => s.activeRoute);
  const isNavigating = useNavigationStore((s) => s.isNavigating);
  const updateTrafficEta = useNavigationStore((s) => s.updateTrafficEta);

  // Track normalizedSegments changes via the store so we can debounce recomputation.
  // We use the store reference to avoid re-creating the interval effect on every
  // traffic data update; the computation function reads fresh data via getState().
  const normalizedSegments = useTrafficStore((s) => s.normalizedSegments);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isNavigating || !activeRoute) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      return;
    }

    /**
     * Compute the local segment-by-segment traffic ETA and update the
     * navigation store. Uses getState() to always read the latest traffic data.
     */
    const computeLocalEta = () => {
      const route = useNavigationStore.getState().activeRoute;
      if (!route) return;

      const maneuvers = route.legs.flatMap((l) => l.maneuvers);
      const segments = extractRouteSegments(route.geometry, undefined, maneuvers);
      const trafficData = useTrafficStore.getState().normalizedSegments;
      const result = calculateTrafficETA(segments, trafficData);

      const matchRatio =
        result.segmentCount > 0 ? result.matchedSegmentCount / result.segmentCount : 0;

      updateTrafficEta(result.totalSeconds, result.freeFlowTotalSeconds, matchRatio);

      // If local traffic coverage is too sparse, supplement with TomTom API
      if (matchRatio < MIN_MATCH_RATIO_FOR_LOCAL) {
        fetchRouteTrafficEta(route.geometry).then((tomtomResult) => {
          if (tomtomResult) {
            const freeFlow = Math.max(
              tomtomResult.travelTimeSeconds - tomtomResult.trafficDelaySeconds,
              0,
            );
            // Prefer TomTom when local coverage is negligible; otherwise keep local
            if (matchRatio < 0.01) {
              updateTrafficEta(tomtomResult.travelTimeSeconds, freeFlow, 1);
            }
          }
        });
      }
    };

    // Compute immediately, then periodically
    computeLocalEta();
    intervalRef.current = setInterval(computeLocalEta, ETA_REFRESH_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [isNavigating, activeRoute, updateTrafficEta]);

  // Also recompute when traffic data changes (debounced to avoid excessive
  // recomputation from rapid P2P probe updates).
  useEffect(() => {
    if (!isNavigating || !activeRoute) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const route = useNavigationStore.getState().activeRoute;
      if (!route) return;

      const maneuvers = route.legs.flatMap((l) => l.maneuvers);
      const segments = extractRouteSegments(route.geometry, undefined, maneuvers);
      const trafficData = useTrafficStore.getState().normalizedSegments;
      const result = calculateTrafficETA(segments, trafficData);

      const matchRatio =
        result.segmentCount > 0 ? result.matchedSegmentCount / result.segmentCount : 0;
      updateTrafficEta(result.totalSeconds, result.freeFlowTotalSeconds, matchRatio);
    }, 3000); // 3s debounce for traffic data changes

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [normalizedSegments, isNavigating, activeRoute, updateTrafficEta]);
}
