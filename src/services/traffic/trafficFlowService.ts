import type { NormalizedTrafficSegment } from '../../models/traffic';
import { MIN_PEER_THRESHOLD } from '../../models/traffic';
import { useTrafficStore } from '../../stores/trafficStore';
import { fetchTomTomTraffic, type ViewportBounds } from './tomtomFetcher';
import { convertP2PToNormalized, mergeTrafficSources } from './trafficMerger';
import {
  initHyperswarmBridge,
  disposeHyperswarmBridge,
  onPeerCount,
  onAggregatedUpdate,
  suspend as swarmSuspend,
  resume as swarmResume,
} from './hyperswarmBridge';
import {
  initNostrFallback,
  disposeNostrFallback,
  onProbe as onNostrProbe,
  getConnectedRelayCount,
} from './nostrFallback';
import { ingestProbe } from './trafficAggregator';
import { TRAFFIC_FETCH_DEBOUNCE_MS, TRAFFIC_REFRESH_INTERVAL_MS } from '../../constants/config';

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let refreshInterval: ReturnType<typeof setInterval> | null = null;

/** Fetch traffic from all sources, merge, and update the store. */
async function fetchAndUpdateTraffic(viewport: ViewportBounds): Promise<void> {
  const store = useTrafficStore.getState();
  if (store.isExternalFetchLoading) return;

  useTrafficStore.getState().setExternalFetchLoading(true);
  try {
    // Fetch TomTom traffic (HERE disabled for now)
    const tomtomResult = await fetchTomTomTraffic(viewport).catch(
      () => [] as NormalizedTrafficSegment[],
    );
    const tomtomSegments = tomtomResult;

    // Convert P2P probes to NormalizedTrafficSegment
    const p2pSegments: NormalizedTrafficSegment[] = Object.values(
      useTrafficStore.getState().segmentTraffic,
    ).map(convertP2PToNormalized);

    // Merge all sources with confidence weighting
    const allSegments = [...tomtomSegments, ...p2pSegments];

    if (allSegments.length > 0) {
      const previousTimestamp = store.lastExternalFetchAt ?? undefined;
      const merged = mergeTrafficSources(allSegments, previousTimestamp);
      if (merged.length > 0) {
        useTrafficStore.getState().setNormalizedSegments(merged);
      }
    }
    // If all sources returned empty, keep previous data
  } catch (error) {
    // Silent failure: keep previous normalizedSegments in store,
    // continue with stale data until next successful refresh.
    const msg =
      error instanceof Error ? error.message.replace(/key=[^&]*/g, 'key=REDACTED') : String(error);
    console.warn('[TrafficFlowService] Fetch failed, keeping previous data:', msg);
  } finally {
    useTrafficStore.getState().setExternalFetchLoading(false);
  }
}

/** Build ViewportBounds from mapStore viewport state. */
function viewportToBounds(viewport: { lat: number; lng: number; zoom: number }): ViewportBounds {
  // Approximate the viewport bounding box from center + zoom
  // At zoom z, the visible range is roughly 360 / 2^z degrees
  const span = 360 / Math.pow(2, viewport.zoom);
  const latSpan = span / 2; // latitude span is half of longitude span
  return {
    west: viewport.lng - span / 2,
    south: viewport.lat - latSpan / 2,
    east: viewport.lng + span / 2,
    north: viewport.lat + latSpan / 2,
    zoom: viewport.zoom,
  };
}

/**
 * Trigger a debounced traffic fetch for the given viewport.
 * Cancels any pending fetch timer and starts a new one.
 */
export function fetchTrafficDebounced(viewport: { lat: number; lng: number; zoom: number }): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    const bounds = viewportToBounds(viewport);
    fetchAndUpdateTraffic(bounds);
  }, TRAFFIC_FETCH_DEBOUNCE_MS);
}

/**
 * Start the periodic 60s traffic refresh timer for active navigation.
 * Uses the route bounding box for the fetch area.
 */
export function startPeriodicRefresh(
  routeBBox: [number, number, number, number],
  zoom: number,
): void {
  stopPeriodicRefresh();
  refreshInterval = setInterval(() => {
    const bounds: ViewportBounds = {
      west: routeBBox[0],
      south: routeBBox[1],
      east: routeBBox[2],
      north: routeBBox[3],
      zoom,
    };
    fetchAndUpdateTraffic(bounds);
  }, TRAFFIC_REFRESH_INTERVAL_MS);
}

/** Stop the periodic traffic refresh timer. */
export function stopPeriodicRefresh(): void {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
}

/** Fetch traffic data immediately (no debounce) for a given bounds. */
export async function fetchTrafficImmediate(viewport: ViewportBounds): Promise<void> {
  await fetchAndUpdateTraffic(viewport);
}

// ── P2P Lifecycle (Hyperswarm + Nostr fallback) ─────────────────────

let peerCountUnsub: (() => void) | null = null;
let aggregatedUnsub: (() => void) | null = null;
let nostrProbeUnsub: (() => void) | null = null;
let modeCheckInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Initialize the full P2P traffic system:
 *   1. Start the Bare worklet running Hyperswarm
 *   2. Connect to Nostr relays as fallback
 *   3. Wire up event handlers to the traffic store
 */
export async function initTrafficP2P(): Promise<void> {
  // Start Hyperswarm worklet
  initHyperswarmBridge();

  // Listen for peer count changes from the worklet
  peerCountUnsub = onPeerCount((count) => {
    useTrafficStore.getState().setSwarmPeerCount(count);
    updateTrafficMode(count);
  });

  // Listen for aggregated traffic state from the worklet
  aggregatedUnsub = onAggregatedUpdate((states) => {
    useTrafficStore.getState().bulkUpdateSegments(states);
  });

  // Start Nostr fallback connections
  await initNostrFallback();

  // Listen for probes arriving via Nostr relays
  nostrProbeUnsub = onNostrProbe((probe) => {
    const state = ingestProbe(probe);
    if (state) {
      useTrafficStore.getState().updateSegment(state);
    }
  });

  // Periodically check relay count and update mode
  modeCheckInterval = setInterval(() => {
    const relayCount = getConnectedRelayCount();
    useTrafficStore.getState().setNostrRelayCount(relayCount);
  }, 10_000);
}

/** Tear down all P2P traffic connections. */
export function disposeTrafficP2P(): void {
  peerCountUnsub?.();
  aggregatedUnsub?.();
  nostrProbeUnsub?.();
  peerCountUnsub = null;
  aggregatedUnsub = null;
  nostrProbeUnsub = null;

  if (modeCheckInterval) {
    clearInterval(modeCheckInterval);
    modeCheckInterval = null;
  }

  disposeHyperswarmBridge();
  disposeNostrFallback();
}

/** Suspend P2P connections (app backgrounded). */
export function suspendTrafficP2P(): void {
  swarmSuspend();
}

/** Resume P2P connections (app foregrounded). */
export function resumeTrafficP2P(): void {
  swarmResume();
}

function updateTrafficMode(swarmPeerCount: number): void {
  const mode = swarmPeerCount >= MIN_PEER_THRESHOLD ? 'hyperswarm' : 'nostr';
  useTrafficStore.getState().setTrafficMode(mode);
}
