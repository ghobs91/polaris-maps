import type { NormalizedTrafficSegment } from '../../models/traffic';
import { MIN_PEER_THRESHOLD } from '../../models/traffic';
import type { TrafficAreaCondition } from '../../models/trafficHistory';
import type { ConditionObservation } from './trafficHistoryService';
import { useTrafficStore } from '../../stores/trafficStore';
import { useNavigationStore } from '../../stores/navigationStore';
import { fetchTomTomTraffic, sampleRoutePoints, type ViewportBounds } from './tomtomFetcher';
import { sampleRouteTileColors } from './tilePixelSampler';
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
import { getTrafficHistory, geohash5For, geohash5CellsForBounds } from './trafficHistoryIndex';
import { currentTimeBucket, bucketLabel } from './trafficTimeBuckets';
import { resolveTrafficConditions, type CascadePoint } from './trafficCascade';
import {
  initP2pConditionQuery,
  onPeerConditionRequest,
  respondToConditionRequest,
  conditionToWire,
} from './trafficP2pQuery';
import {
  initTrafficTileService,
  ensureTrafficTileServer,
  ensureTrafficTiles,
  pruneTileCache,
} from './trafficTileService';
import { tilesForViewport } from './trafficTileMath';

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let refreshInterval: ReturnType<typeof setInterval> | null = null;
let routeFetchInProgress = false;

/**
 * Index observed segments into the historical condition index under the
 * current time bucket. Every source (TomTom seeds, P2P responses, probe
 * aggregates) funnels through here so the index accumulates over time.
 */
async function indexSegmentsIntoHistory(segments: NormalizedTrafficSegment[]): Promise<void> {
  if (segments.length === 0) return;
  const bucket = currentTimeBucket();
  const observations: ConditionObservation[] = [];

  const byCell = new Map<string, NormalizedTrafficSegment[]>();
  for (const seg of segments) {
    const first = seg.coordinates[0];
    if (!first) continue;
    const cell = geohash5For(first[1], first[0]);
    const list = byCell.get(cell);
    if (list) {
      list.push(seg);
    } else {
      byCell.set(cell, [seg]);
    }
  }

  for (const [cell, segs] of byCell) {
    let speedSum = 0;
    let ratioSum = 0;
    let wSum = 0;
    let freeFlowMax = 0;
    for (const s of segs) {
      const w = Math.max(0.05, s.confidence);
      speedSum += s.currentSpeedMph * w;
      ratioSum += s.congestionRatio * w;
      wSum += w;
      freeFlowMax = Math.max(freeFlowMax, s.freeFlowSpeedMph);
    }
    observations.push({
      geohash5: cell,
      avgSpeedMph: wSum > 0 ? speedSum / wSum : 0,
      avgCongestionRatio: wSum > 0 ? ratioSum / wSum : 1,
      freeFlowSpeedMph: freeFlowMax,
    });
  }

  await getTrafficHistory().recordObservations(bucket, observations);
  useTrafficStore.getState().setHistoryEntryCount(await getTrafficHistory().count());
}

/** Publish the resolved conditions to the traffic store as segments. */
function publishResolvedSegments(
  segments: NormalizedTrafficSegment[],
  source: string,
  p2pSegments: NormalizedTrafficSegment[],
): void {
  const allSegments = [...segments, ...p2pSegments];
  if (allSegments.length === 0) return;

  const previousTimestamp = useTrafficStore.getState().lastExternalFetchAt ?? undefined;
  const merged = mergeTrafficSources(allSegments, previousTimestamp);
  if (merged.length > 0) {
    useTrafficStore.getState().setNormalizedSegments(merged);
    useTrafficStore.getState().setLastResolveSource(source);
  }
}

/** Fetch traffic from all sources, merge, and update the store. */
async function fetchAndUpdateTraffic(viewport: ViewportBounds): Promise<void> {
  const store = useTrafficStore.getState();
  if (store.isExternalFetchLoading) return;

  // Don't overwrite route-specific traffic data with viewport data when a
  // route is currently displayed (preview or active navigation). The
  // route-aligned fetch provides more accurate per-segment data.
  const navStore = useNavigationStore.getState();
  if (navStore.activeRoute ?? navStore.routePreview) return;

  useTrafficStore.getState().setExternalFetchLoading(true);
  try {
    const bucket = currentTimeBucket();
    const cells = geohash5CellsForBounds(
      viewport.south,
      viewport.west,
      viewport.north,
      viewport.east,
    );

    // Sample points mirroring the old TomTom grid so synthesized segments
    // have spatial coverage across the viewport.
    const gridSize = gridSizeForZoom(viewport.zoom);
    const points: CascadePoint[] = [];
    const latStep = (viewport.north - viewport.south) / (gridSize + 1);
    const lngStep = (viewport.east - viewport.west) / (gridSize + 1);
    for (let row = 1; row <= gridSize; row++) {
      for (let col = 1; col <= gridSize; col++) {
        const lat = viewport.south + latStep * row;
        const lng = viewport.west + lngStep * col;
        points.push({ lat, lng, cell: geohash5For(lat, lng) });
      }
    }

    const result = await resolveTrafficConditions({
      cells,
      bucket,
      points,
      history: getTrafficHistory(),
      seedFromTomTom: () =>
        fetchTomTomTraffic(viewport).catch(() => [] as NormalizedTrafficSegment[]),
      indexObservations: (b, obs) => getTrafficHistory().recordObservations(b, obs),
    });

    const p2pSegments: NormalizedTrafficSegment[] = Object.values(
      useTrafficStore.getState().segmentTraffic,
    ).map(convertP2PToNormalized);

    publishResolvedSegments(result.segments, result.source, p2pSegments);
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

/** Determine the grid size (rows × cols) for viewport sampling based on zoom. */
function gridSizeForZoom(zoom: number): number {
  if (zoom <= 12) return 3;
  if (zoom >= 16) return 5;
  return 4;
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

/**
 * Fetch traffic data along a specific route polyline.
 * Samples points along the route geometry so returned segments
 * align with the actual path (instead of a viewport grid).
 */
async function fetchAndUpdateRouteTraffic(routeCoords: [number, number][]): Promise<void> {
  if (routeFetchInProgress) {
    if (__DEV__) console.log('[TrafficFlowService] route fetch already in progress, skipping');
    return;
  }

  routeFetchInProgress = true;
  if (__DEV__)
    console.log(`[TrafficFlowService] fetching route traffic for ${routeCoords.length} coords`);
  try {
    const bucket = currentTimeBucket();
    const sampled = sampleRoutePoints(routeCoords);
    const points: CascadePoint[] = sampled.map((p) => ({
      lat: p.lat,
      lng: p.lng,
      cell: geohash5For(p.lat, p.lng),
    }));
    const cells = [...new Set(points.map((p) => p.cell))];

    const result = await resolveTrafficConditions({
      cells,
      bucket,
      points,
      history: getTrafficHistory(),
      // TomTom tier: sample colors from the flow raster tiles (same source
      // as the traffic overlay) instead of the point-based Flow Segment API.
      seedFromTomTom: () => sampleRouteTileColors(routeCoords),
      indexObservations: (b, obs) => getTrafficHistory().recordObservations(b, obs),
    });

    if (__DEV__) {
      console.log(
        `[TrafficFlowService] route resolved via ${result.source} for bucket ${bucketLabel(bucket)} ` +
          `(${result.segments.length} segments, ${result.unresolvedCells.length} unresolved cells)`,
      );
    }

    const p2pSegments: NormalizedTrafficSegment[] = Object.values(
      useTrafficStore.getState().segmentTraffic,
    ).map(convertP2PToNormalized);

    publishResolvedSegments(result.segments, result.source, p2pSegments);
  } catch (error) {
    const msg =
      error instanceof Error ? error.message.replace(/key=[^&]*/g, 'key=REDACTED') : String(error);
    console.warn('[TrafficFlowService] Route traffic fetch failed:', msg);
  } finally {
    routeFetchInProgress = false;
  }
}

/** Fetch route-aligned traffic immediately. */
export async function fetchRouteTrafficImmediate(routeCoords: [number, number][]): Promise<void> {
  await fetchAndUpdateRouteTraffic(routeCoords);
}

/**
 * Start the periodic traffic refresh timer using route-aligned sampling.
 * Uses the decoded route coordinates for the fetch area.
 */
export function startRoutePeriodicRefresh(routeCoords: [number, number][]): void {
  stopPeriodicRefresh();
  refreshInterval = setInterval(() => {
    fetchAndUpdateRouteTraffic(routeCoords);
  }, TRAFFIC_REFRESH_INTERVAL_MS);
}

// ── P2P Lifecycle (Hyperswarm + Nostr fallback) ─────────────────────

let peerCountUnsub: (() => void) | null = null;
let aggregatedUnsub: (() => void) | null = null;
let nostrProbeUnsub: (() => void) | null = null;
let condRequestUnsub: (() => void) | null = null;
let modeCheckInterval: ReturnType<typeof setInterval> | null = null;

/** Throttle for indexing live P2P probe aggregates into history. */
let lastProbeIndexAt = 0;
const PROBE_INDEX_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Initialize the full P2P traffic system:
 *   1. Start the Bare worklet running Hyperswarm
 *   2. Connect to Nostr relays as fallback
 *   3. Wire up event handlers to the traffic store
 *   4. Serve P2P condition requests from the local history index
 */
export async function initTrafficP2P(): Promise<void> {
  // Start Hyperswarm worklet
  initHyperswarmBridge();

  // Collect responses for our own condition queries
  initP2pConditionQuery();

  // Tile service: serve cached traffic tiles to MapLibre via the local
  // HTTP server and exchange tiles with peers.
  initTrafficTileService();
  void ensureTrafficTileServer();
  void pruneTileCache();

  // Listen for peer count changes from the worklet
  peerCountUnsub = onPeerCount((count) => {
    useTrafficStore.getState().setSwarmPeerCount(count);
    updateTrafficMode(count);
  });

  // Listen for aggregated traffic state from the worklet
  aggregatedUnsub = onAggregatedUpdate((states) => {
    useTrafficStore.getState().bulkUpdateSegments(states);

    // Feed live probe aggregates into the historical index (throttled).
    const now = Date.now();
    if (now - lastProbeIndexAt >= PROBE_INDEX_INTERVAL_MS) {
      lastProbeIndexAt = now;
      const segments = states.map(convertP2PToNormalized);
      void indexSegmentsIntoHistory(segments).catch(() => {});
    }
  });

  // Answer peers' condition requests from the local index
  condRequestUnsub = onPeerConditionRequest((req) => {
    void (async () => {
      const history = getTrafficHistory();
      const fresh = await history.getFresh(req.cells, req.bucket);
      const freshCells = new Set(fresh.map((c) => c.geohash5));
      const remaining = req.cells.filter((c) => !freshCells.has(c));
      const historical = await history.getHistorical(remaining, req.bucket);

      const entries = [
        ...fresh.map((c) => conditionToWire(c, true)),
        ...historical.map((c) => conditionToWire(c, false)),
      ];
      if (entries.length > 0) {
        respondToConditionRequest(req.connId, req.id, entries);
      }
    })().catch(() => {});
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
  condRequestUnsub?.();
  peerCountUnsub = null;
  aggregatedUnsub = null;
  nostrProbeUnsub = null;
  condRequestUnsub = null;

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

// ── Traffic tile seeding (raster overlay) ───────────────────────────

let lastSeedBumpAt = 0;
const SEED_BUMP_THROTTLE_MS = 2_000;

/**
 * Seed traffic tiles covering the visible viewport through the
 * disk → P2P → TomTom cascade. Bumps the raster source version when new
 * tiles were written so MapLibre re-requests the area.
 */
export async function seedTrafficTilesForViewport(
  centerLat: number,
  centerLng: number,
  zoom: number,
  screenWidth: number,
  screenHeight: number,
): Promise<void> {
  const tiles = tilesForViewport(centerLat, centerLng, zoom, screenWidth, screenHeight);
  if (tiles.length === 0) return;

  const seeded = await ensureTrafficTiles(tiles);
  if (seeded > 0) {
    const now = Date.now();
    if (now - lastSeedBumpAt >= SEED_BUMP_THROTTLE_MS) {
      lastSeedBumpAt = now;
      useTrafficStore.getState().bumpTrafficTileSeedVersion();
    }
  }
}

export type { TrafficAreaCondition };
