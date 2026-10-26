import { useEffect, useRef } from 'react';
import { useTransitStore } from '../stores/transitStore';
import { useOsmPoiStore } from '../stores/osmPoiStore';
import {
  fetchTransitLines,
  getCachedLines,
  hasCachedLines,
  prewarmOtpLines,
  prewarmTransitCache,
} from '../services/transit/transitLineFetcher';
import { getRegionContainingPoint } from '../services/regions/regionRepository';
import { getOfflineDotGtfsLines, hasOfflineDotGtfsData } from '../services/transit/dotGtfsOffline';
import { isOnline } from '../services/regions/connectivityService';
import { TRANSIT_FETCH_DEBOUNCE_MS } from '../constants/config';
import { filterTransitLinesToBounds } from '../utils/transitViewport';
import type { TransitRouteLine } from '../models/transit';

const MIN_ZOOM = 8;
/** Spinner auto-dismiss window so a slow/stuck feed can't pin it forever. */
const TRANSIT_LOADING_TIMEOUT_MS = 15_000;

/** How long the map must sit still before prewarming while transit is hidden. */
const PREWARM_DEBOUNCE_MS = 1_500;

/**
 * Fetches transit route lines from Overpass for the visible viewport.
 *
 * Performance strategy:
 *  - Lines accumulate in a persistent spatial cache (never evicted on toggle)
 *  - Toggle on → instant restore from cache, then fetch new tiles if needed
 *  - Toggle off → lines stay in the store (layers hide via visibility style)
 *  - Viewport pan → only fetch uncovered tiles, merge into accumulated set
 *  - Only lines intersecting the viewport are put in the store, so the
 *    render cost never grows with the number of cities previously visited
 *  - While the layer is hidden, an idle viewport prewarms its cache so
 *    toggling on later does not start from a cold network round-trip
 */
export function useTransitStops() {
  const transitLayerVisible = useTransitStore((s) => s.transitLayerVisible);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Track whether the first fetch since toggle-on has fired. */
  const hasFetchedRef = useRef(false);

  useEffect(() => {
    if (!transitLayerVisible) {
      // Don't clear lines on toggle-off — they stay for instant restore
      hasFetchedRef.current = false;

      // Prewarm the current viewport while transit is hidden, so the next
      // toggle-on paints immediately instead of waiting on the network.
      const schedulePrewarm = () => {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          const { viewportBounds, currentZoom } = useOsmPoiStore.getState();
          if (!viewportBounds || (currentZoom ?? 0) < MIN_ZOOM) return;
          if (!isOnline()) return;
          const lat = (viewportBounds.minLat + viewportBounds.maxLat) / 2;
          const lng = (viewportBounds.minLng + viewportBounds.maxLng) / 2;
          prewarmTransitCache(lat, lng).catch(() => {});
          prewarmOtpLines(lat, lng);
        }, PREWARM_DEBOUNCE_MS);
      };

      const { viewportBounds: initialBounds, currentZoom: initialZoom } = useOsmPoiStore.getState();
      if (initialBounds && (initialZoom ?? 0) >= MIN_ZOOM) schedulePrewarm();

      const unsub = useOsmPoiStore.subscribe((state, prev) => {
        if (useTransitStore.getState().transitLayerVisible) return;
        if (!state.viewportBounds) return;
        if (
          state.viewportBounds === prev.viewportBounds &&
          state.currentZoom === prev.currentZoom
        ) {
          return;
        }
        if ((state.currentZoom ?? 0) < MIN_ZOOM) return;
        schedulePrewarm();
      });

      return () => {
        unsub();
        if (timerRef.current) clearTimeout(timerRef.current);
      };
    }

    const initial = useOsmPoiStore.getState();

    // Restore cached lines immediately on toggle-on (no network). Only the
    // tiles around the viewport are hydrated, not the whole disk cache.
    if (hasCachedLines()) {
      applyLines(getCachedLines(initial.viewportBounds ?? undefined));
    }

    // Always try to load offline DOT GTFS data — even if other lines
    // are already cached (e.g. Amtrak). Merges with existing lines.
    loadOfflineDotGtfsIfAvailable();

    // Attempt to fetch for current viewport immediately
    if (initial.viewportBounds && (initial.currentZoom ?? 0) >= MIN_ZOOM) {
      hasFetchedRef.current = true;
      // If offline and we already loaded DOT lines, skip the network fetch
      if (!isOnline() && useTransitStore.getState().routeLines.length > 0) {
        return;
      }
      fetchAndMergeLines(initial.viewportBounds);
    }

    // Subscribe to viewport changes
    const unsub = useOsmPoiStore.subscribe((state, prev) => {
      if (!useTransitStore.getState().transitLayerVisible) return;
      if (!state.viewportBounds) return;
      if (state.viewportBounds === prev.viewportBounds && state.currentZoom === prev.currentZoom) {
        return;
      }

      if ((state.currentZoom ?? 0) < MIN_ZOOM) return; // don't clear, just skip

      // First valid viewport after toggle-on: fetch immediately (no debounce)
      if (!hasFetchedRef.current) {
        hasFetchedRef.current = true;
        if (!isOnline() && useTransitStore.getState().routeLines.length > 0) {
          return;
        }
        fetchAndMergeLines(state.viewportBounds);
        return;
      }

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        const { viewportBounds: bounds } = useOsmPoiStore.getState();
        if (bounds) {
          if (!isOnline() && useTransitStore.getState().routeLines.length > 0) {
            return;
          }
          fetchAndMergeLines(bounds);
        }
      }, TRANSIT_FETCH_DEBOUNCE_MS);
    });

    return () => {
      unsub();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [transitLayerVisible]);
}

/** Monotonic token so a stale viewport fetch cannot clear a newer one's spinner. */
let fetchGeneration = 0;

/**
 * Put lines in the store, clipped to the current viewport (plus padding).
 * Unfiltered line objects keep their identity, so the bounds cache in
 * `transitViewport` makes this O(number of lines).
 */
function applyLines(lines: TransitRouteLine[]): void {
  const { viewportBounds } = useOsmPoiStore.getState();
  const visible = viewportBounds ? filterTransitLinesToBounds(lines, viewportBounds) : lines;
  useTransitStore.getState().setRouteLines(visible);
}

async function fetchAndMergeLines(bounds: {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}) {
  const generation = ++fetchGeneration;
  const store = useTransitStore.getState();
  store.setIsLoadingLines(true);

  // Clear the spinner once real data arrives (via onProgress) or when both
  // sources settle.  `fetchTransitLines` returns cached lines immediately,
  // so the awaited result is not a reliable "fetch finished" signal.
  // A timeout keeps a slow feed from pinning the spinner forever.
  let loadingCleared = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clearLoading = () => {
    if (loadingCleared || generation !== fetchGeneration) return;
    loadingCleared = true;
    if (timer) clearTimeout(timer);
    useTransitStore.getState().setIsLoadingLines(false);
  };
  timer = setTimeout(clearLoading, TRANSIT_LOADING_TIMEOUT_MS);

  try {
    const lines = await fetchTransitLines(
      bounds.minLat,
      bounds.minLng,
      bounds.maxLat,
      bounds.maxLng,
      (partial) => {
        applyLines(partial);
        if (partial.length > 0) clearLoading();
      },
      clearLoading,
    );
    if (generation === fetchGeneration) applyLines(lines);
  } catch (err) {
    console.error('[transit] fetchTransitLines failed:', err);
    clearLoading();
  }
}

/**
 * Load offline DOT GTFS transit lines if the user is in a downloaded
 * region with pre-cached GTFS data. Merges with existing cached lines
 * so Amtrak + local transit both appear.
 */
async function loadOfflineDotGtfsIfAvailable(): Promise<void> {
  const state = useOsmPoiStore.getState();
  if (!state.viewportBounds) return;

  const { minLat, minLng, maxLat, maxLng } = state.viewportBounds;
  const centreLat = (minLat + maxLat) / 2;
  const centreLng = (minLng + maxLng) / 2;

  const region = await getRegionContainingPoint(centreLat, centreLng);
  if (!region) return;

  if (!hasOfflineDotGtfsData(region.id)) return;

  try {
    const offlineLines = await getOfflineDotGtfsLines(region.id);
    if (offlineLines.length === 0) return;

    // Merge with existing lines — don't replace cached Amtrak/OTP lines
    const existing = useTransitStore.getState().routeLines;
    const existingIds = new Set(existing.map((l) => l.id));
    const merged = [...existing];
    for (const line of offlineLines) {
      if (!existingIds.has(line.id)) {
        merged.push(line);
      }
    }
    applyLines(merged);
  } catch {
    // Silently ignore — offline transit is best-effort
  }
}
