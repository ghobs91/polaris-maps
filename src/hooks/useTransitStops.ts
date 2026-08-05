import { useEffect, useRef } from 'react';
import { useTransitStore } from '../stores/transitStore';
import { useOsmPoiStore } from '../stores/osmPoiStore';
import {
  fetchTransitLines,
  getCachedLines,
  hasCachedLines,
} from '../services/transit/transitLineFetcher';
import { getRegionContainingPoint } from '../services/regions/regionRepository';
import { getOfflineDotGtfsLines, hasOfflineDotGtfsData } from '../services/transit/dotGtfsOffline';
import { isOnline } from '../services/regions/connectivityService';
import { TRANSIT_FETCH_DEBOUNCE_MS } from '../constants/config';

const MIN_ZOOM = 8;

/**
 * Fetches transit route lines from Overpass for the visible viewport.
 *
 * Performance strategy:
 *  - Lines accumulate in a persistent spatial cache (never evicted on toggle)
 *  - Toggle on → instant restore from cache, then fetch new tiles if needed
 *  - Toggle off → lines stay in the store (layers hide via visibility style)
 *  - Viewport pan → only fetch uncovered tiles, merge into accumulated set
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
      return;
    }

    // Restore cached lines immediately on toggle-on (no network)
    if (hasCachedLines()) {
      useTransitStore.getState().setRouteLines(getCachedLines());
    }

    // Always try to load offline DOT GTFS data — even if other lines
    // are already cached (e.g. Amtrak). Merges with existing lines.
    loadOfflineDotGtfsIfAvailable();

    // Attempt to fetch for current viewport immediately
    const { viewportBounds, currentZoom } = useOsmPoiStore.getState();
    if (viewportBounds && (currentZoom ?? 0) >= MIN_ZOOM) {
      hasFetchedRef.current = true;
      // If offline and we already loaded DOT lines, skip the network fetch
      if (!isOnline() && useTransitStore.getState().routeLines.length > 0) {
        return;
      }
      fetchAndMergeLines(viewportBounds);
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

async function fetchAndMergeLines(bounds: {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}) {
  const store = useTransitStore.getState();
  store.setIsLoadingLines(true);

  // Hide loading spinner as soon as we have any lines (via onProgress).
  // fetchTransitLines races Overpass vs OTP/GTFS and returns early when
  // either source produces results.  The slower source continues in
  // background and pushes its results via onProgress.
  let loadingCleared = false;

  try {
    const lines = await fetchTransitLines(
      bounds.minLat,
      bounds.minLng,
      bounds.maxLat,
      bounds.maxLng,
      (partial) => {
        useTransitStore.getState().setRouteLines(partial);
        if (!loadingCleared && partial.length > 0) {
          loadingCleared = true;
          useTransitStore.getState().setIsLoadingLines(false);
        }
      },
    );
    useTransitStore.getState().setRouteLines(lines);
  } catch (err) {
    console.error('[transit] fetchTransitLines failed:', err);
  } finally {
    if (!loadingCleared) {
      useTransitStore.getState().setIsLoadingLines(false);
    }
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
    useTransitStore.getState().setRouteLines(merged);
  } catch {
    // Silently ignore — offline transit is best-effort
  }
}
