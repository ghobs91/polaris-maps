import { useEffect, useRef } from 'react';
import { useTransitStore } from '../stores/transitStore';
import { useOsmPoiStore } from '../stores/osmPoiStore';
import {
  fetchTransitLines,
  getCachedLines,
  hasCachedLines,
} from '../services/transit/transitLineFetcher';
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

    // Attempt to fetch for current viewport immediately
    const { viewportBounds, currentZoom } = useOsmPoiStore.getState();
    if (viewportBounds && (currentZoom ?? 0) >= MIN_ZOOM) {
      hasFetchedRef.current = true;
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
        fetchAndMergeLines(state.viewportBounds);
        return;
      }

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        const { viewportBounds: bounds } = useOsmPoiStore.getState();
        if (bounds) fetchAndMergeLines(bounds);
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
  try {
    // fetchTransitLines returns the globally accumulated & deduplicated set
    const lines = await fetchTransitLines(
      bounds.minLat,
      bounds.minLng,
      bounds.maxLat,
      bounds.maxLng,
    );
    useTransitStore.getState().setRouteLines(lines);
  } catch {
    // Silently ignore — Overpass may be unavailable
  } finally {
    useTransitStore.getState().setIsLoadingLines(false);
  }
}
