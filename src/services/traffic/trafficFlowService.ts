import type { NormalizedTrafficSegment, SavedFlowKind } from '../../models/traffic';
import { MIN_PEER_THRESHOLD } from '../../models/traffic';
import type { TrafficAreaCondition } from '../../models/trafficHistory';
import { useTrafficStore } from '../../stores/trafficStore';
import { useNavigationStore } from '../../stores/navigationStore';
import { fetchTomTomTraffic, sampleRoutePoints, type ViewportBounds } from './tomtomFetcher';
import { sampleRouteTileColors } from './tilePixelSampler';
import { convertP2PToNormalized, mergeTrafficSources } from './trafficMerger';
import {
  initHyperswarmBridge,
  disposeHyperswarmBridge,
  getStatus as getSwarmStatus,
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
import { initTopicManager, disposeTopicManager } from './topicManager';
import { logDiagnostic } from '../diagnostics/diagnosticsLog';
import { TRAFFIC_FETCH_DEBOUNCE_MS, TRAFFIC_REFRESH_INTERVAL_MS } from '../../constants/config';
import { isTomTomConfigured } from './tomtomAccess';
import { getTrafficHistory, geohash5For } from './trafficHistoryIndex';
import type { TrafficSourceBreakdown } from '../../models/trafficHistory';
import { publishProfileConditions } from './nostrProfileExchange';
import { currentTimeBucket } from './trafficTimeBuckets';
import { seedThroughCache } from './trafficSeedCache';
import {
  getSavedFlow,
  readSavedFlow,
  readSavedFlowCoverage,
  recordSavedFlow,
  savedFlowBucketForRequest,
} from './trafficSavedFlowIndex';
import { currentSavedFlowBucket } from './savedFlowBucket';
import {
  resolveTrafficConditions,
  observationsFromSegments,
  type CascadePoint,
} from './trafficCascade';
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
  setTrafficTilePeerCount,
} from './trafficTileService';
import { tilesForViewport, tileCenter } from './trafficTileMath';
import { fetchOpenTrafficSegments, type FeedBounds } from './openTrafficFeed';

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let refreshInterval: ReturnType<typeof setInterval> | null = null;
let routeFetchInProgress = false;
/** Wall-clock of the last route-aligned traffic refresh (see the fix-driven path). */
let lastRouteRefreshAt = 0;

/**
 * Index probe-derived segments into the on-device condition index under the
 * current time bucket. This is the only write path into the weekly profile
 * store: upstream seeds (open feeds, TomTom) are answered from
 * `trafficSeedCache` instead, so an upstream observation can never be replayed
 * later as if the device had observed it.
 */
async function indexSegmentsIntoHistory(segments: NormalizedTrafficSegment[]): Promise<void> {
  if (segments.length === 0) return;
  const bucket = currentTimeBucket();
  // Shares the cascade's aggregation so a zero "no speed" sentinel never
  // dilutes a real speed (and the two write paths cannot drift apart).
  const observations = Array.from(
    observationsFromSegments(segments, (lng, lat) => geohash5For(lat, lng)).values(),
  );

  await getTrafficHistory().recordObservations(bucket, observations);
  useTrafficStore.getState().setHistoryEntryCount(await getTrafficHistory().count());

  // Probe-derived rows are shareable: offer the affected cells' profiles to
  // the Nostr relay store (throttled + probe-share gated inside).
  if (observations.length > 0) {
    const cells = Array.from(new Set(observations.map((o) => o.geohash5)));
    const shareable = await getTrafficHistory().getHistorical(cells, bucket);
    if (shareable.length > 0) {
      await publishProfileConditions(shareable);
    }
  }
}

/**
 * Publish the latest resolution to the traffic store.
 *
 * The cascade has already chosen which tiers are usable for this area (fresh
 * observations, historical averages, seeds), so the resolved set is the
 * complete answer and replaces the store wholesale. Publishing even an empty
 * set is intentional: a successful resolution with no data must clear segments
 * from a previous route or area, otherwise stale (or bad) segments linger and
 * keep skewing the ETA. Failed fetches never reach here, so transient errors
 * still keep the previous data.
 */
export function publishResolvedSegments(
  segments: NormalizedTrafficSegment[],
  source: string,
  p2pSegments: NormalizedTrafficSegment[],
  breakdown?: TrafficSourceBreakdown,
): void {
  const merged = mergeTrafficSources([...segments, ...p2pSegments]);
  useTrafficStore.getState().setNormalizedSegments(merged);
  useTrafficStore.getState().setLastResolveSource(source);
  useTrafficStore.getState().setLastResolveBreakdown(breakdown ?? null);
}

/** Dev-mode provenance line: which tier answered how many cells. */
function logResolution(label: string, source: string, breakdown: TrafficSourceBreakdown): void {
  if (!__DEV__) return;
  console.log(
    `[TrafficFlowService] ${label} resolved via ${source} ` +
      `(${breakdown.requestedCells} cells: device ${breakdown.localProbe}` +
      `${breakdown.localSeeded > 0 ? `+${breakdown.localSeeded} seeded` : ''}, ` +
      `tomtom ${breakdown.coldStart}, peers ${breakdown.p2p}, open ${breakdown.openFeed}` +
      `${breakdown.savedFlow > 0 ? `, saved ${breakdown.savedFlow}` : ''}, ` +
      `unresolved ${breakdown.unresolved}, provider requests ${breakdown.providerRequests})`,
  );
}

/**
 * Wrap an upstream tier so whatever it fetches is saved under the weekday +
 * hour bucket it was observed in, at the granularity it was observed at
 * (`kind`). Recording is fire-and-forget and preserves each segment's own
 * observation time, so re-saving a replay cannot make it look current.
 *
 * This is the other half of the saved-flow rule: a repeat request in the same
 * bucket is answered from what this call stored, not from the provider.
 */
function rememberForFallback(
  kind: SavedFlowKind,
  fetch: (missing: string[]) => Promise<NormalizedTrafficSegment[]>,
): (missing: string[]) => Promise<NormalizedTrafficSegment[]> {
  return async (missing) => {
    const segments = await fetch(missing);
    recordSavedFlow(segments, kind);
    return segments;
  };
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

    // Sample points first, then derive the cells from them. The old path
    // asked for up to 36 viewport cells while the cold-start tier could only
    // query 25, so the tail was permanently unresolved and re-queried on
    // every refresh — the bridge looked like it was consulted for everything.
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
    const cells = [...new Set(points.map((p) => p.cell))];

    const result = await resolveTrafficConditions({
      cells,
      bucket,
      points,
      history: getTrafficHistory(),
      // Free feeds are cached for the same freshness window as cold-start
      // seeds: upstream answers answer requests, they never enter the probe
      // index.
      openFeed: rememberForFallback('segment', (missing) =>
        seedThroughCache(missing, () => fetchOpenTrafficSegments(viewport), {
          // Free feeds are retried next refresh if they came back empty: a
          // transient outage must not hand the cell to the cold-start bridge
          // for the whole negative window.
          negativeTtlMs: 0,
        }),
      ),
      // TomTom is the optional cold-start bridge: only the cells the earlier
      // tiers could not resolve are queried, and only when no fresh cached
      // seed already covers them.
      seedFromTomTom: rememberForFallback('segment', (missing) =>
        seedThroughCache(missing, (stillMissing) => fetchTomTomTraffic(viewport, stillMissing)),
      ),
      // Flow this device already fetched for this weekday + hour answers
      // before any provider call. The viewport resolves cells (colours per
      // area), so either granularity is usable.
      savedFlow: (missing, bucket) =>
        readSavedFlow(missing, savedFlowBucketForRequest(bucket), ['segment', 'tile']),
    });

    logResolution('viewport', result.source, result.breakdown);

    const p2pSegments: NormalizedTrafficSegment[] = Object.values(
      useTrafficStore.getState().segmentTraffic,
    ).map(convertP2PToNormalized);

    publishResolvedSegments(result.segments, result.source, p2pSegments, result.breakdown);
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

/** Bounding box around a route polyline (degrees). */
function boundsFromCoords(coords: [number, number][]): FeedBounds {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [lng, lat] of coords) {
    if (lng < west) west = lng;
    if (lng > east) east = lng;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  if (!Number.isFinite(west)) return { west: 0, south: 0, east: 0, north: 0 };
  return { west, south, east, north };
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
      openFeed: rememberForFallback('segment', (missing) =>
        seedThroughCache(missing, () => fetchOpenTrafficSegments(boundsFromCoords(routeCoords)), {
          negativeTtlMs: 0,
        }),
      ),
      // TomTom cold-start: query only route cells the earlier tiers missed and
      // no fresh cached seed covers. Tile decoding is cached per z/x/y too, so
      // a route refreshed inside the window costs no provider request.
      seedFromTomTom: isTomTomConfigured()
        ? rememberForFallback('tile', (missing) =>
            seedThroughCache(missing, (stillMissing) =>
              sampleRouteTileColors(routeCoords, stillMissing),
            ),
          )
        : async () => [],
      // Route resolution needs per-point ratios, which tile point-samples
      // carry; saved road segments are accepted too because they are finer.
      savedFlow: (missing, bucket) =>
        readSavedFlow(missing, savedFlowBucketForRequest(bucket), ['segment', 'tile']),
    });

    logResolution('route', result.source, result.breakdown);

    const p2pSegments: NormalizedTrafficSegment[] = Object.values(
      useTrafficStore.getState().segmentTraffic,
    ).map(convertP2PToNormalized);

    publishResolvedSegments(result.segments, result.source, p2pSegments, result.breakdown);
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
  lastRouteRefreshAt = Date.now();
  await fetchAndUpdateRouteTraffic(routeCoords);
}

/**
 * Refresh route traffic if the interval has elapsed.
 *
 * The foreground periodic refresh uses `setInterval`, but iOS suspends JS
 * timers when the screen locks, so a locked phone never refreshes and ETA /
 * traffic colours go stale. Location fixes keep arriving, so background
 * navigation calls this on each fix (see `fixDrivenRefresh`). Shares
 * `lastRouteRefreshAt` with the interval so the two never double-fetch.
 */
export function refreshRouteTrafficIfStale(
  routeCoords: [number, number][],
  now: number = Date.now(),
): boolean {
  if (routeFetchInProgress) return false;
  if (now - lastRouteRefreshAt < TRAFFIC_REFRESH_INTERVAL_MS) return false;
  lastRouteRefreshAt = now;
  void fetchAndUpdateRouteTraffic(routeCoords);
  return true;
}

/**
 * Start the periodic traffic refresh timer using route-aligned sampling.
 * Uses the decoded route coordinates for the fetch area.
 */
export function startRoutePeriodicRefresh(routeCoords: [number, number][]): void {
  stopPeriodicRefresh();
  refreshInterval = setInterval(() => {
    refreshRouteTrafficIfStale(routeCoords);
  }, TRAFFIC_REFRESH_INTERVAL_MS);
}

// ── P2P Lifecycle (Hyperswarm + Nostr fallback) ─────────────────────

let peerCountUnsub: (() => void) | null = null;
let aggregatedUnsub: (() => void) | null = null;
let nostrProbeUnsub: (() => void) | null = null;
let condRequestUnsub: (() => void) | null = null;
let modeCheckInterval: ReturnType<typeof setInterval> | null = null;
let statusPollInterval: ReturnType<typeof setInterval> | null = null;
let nostrFallbackTimer: ReturnType<typeof setTimeout> | null = null;
let nostrInitialized = false;

/** How often to poll the worklet for the full mesh status snapshot. */
const STATUS_POLL_INTERVAL_MS = 15_000;

/**
 * Grace period before opening public Nostr relays. Most launches reach three
 * Hyperswarm peers quickly; delaying the relay connections avoids hammering
 * shared relays with every install during a spike.
 */
const NOSTR_FALLBACK_DELAY_MS = 8_000;

/** Throttle for indexing live P2P probe aggregates into history. */
let lastProbeIndexAt = 0;
const PROBE_INDEX_INTERVAL_MS = 5 * 60 * 1000;

/** Open the relay fallback only if the swarm stays sparse for a grace period. */
function scheduleNostrFallback(): void {
  if (nostrInitialized || nostrFallbackTimer) return;
  if (useTrafficStore.getState().swarmPeerCount >= MIN_PEER_THRESHOLD) return;

  nostrFallbackTimer = setTimeout(() => {
    nostrFallbackTimer = null;
    if (useTrafficStore.getState().swarmPeerCount >= MIN_PEER_THRESHOLD) return;
    void initNostrFallback()
      .then(() => {
        nostrInitialized = true;
      })
      .catch((error) => {
        logDiagnostic('traffic-mesh', 'warn', 'Nostr fallback failed', {
          message: error instanceof Error ? error.message : String(error),
        });
      });
  }, NOSTR_FALLBACK_DELAY_MS);
}

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

  // Apply the link profile (metered links run client-only) and start watching
  // for network changes before any topic is joined.
  initTopicManager();

  // Collect responses for our own condition queries
  initP2pConditionQuery();

  // Tile service: serve cached traffic tiles to MapLibre via the local
  // HTTP server and exchange tiles with peers.
  initTrafficTileService();
  void ensureTrafficTileServer();
  void pruneTileCache();

  // Keep the on-device profile table bounded. Reads already ignore rows past
  // the retention window, but without this they stay on disk forever and the
  // table grows with every cell the device has ever observed.
  void getTrafficHistory()
    .prune()
    .then(() => getTrafficHistory().count())
    .then((rows) => useTrafficStore.getState().setHistoryEntryCount(rows))
    .catch(() => {});

  // Same for the saved-flow table: kept for a month so repeat requests in the
  // same weekday + hour bucket stay free, and trimmed at launch so it cannot
  // grow forever.
  void getSavedFlow()
    .prune()
    .catch(() => {});

  // Listen for peer count changes from the worklet
  peerCountUnsub = onPeerCount((count) => {
    useTrafficStore.getState().setSwarmPeerCount(count);
    // The tile service asks the mesh first only while somebody can answer.
    setTrafficTilePeerCount(count);
    updateTrafficMode(count);
    if (count < MIN_PEER_THRESHOLD) scheduleNostrFallback();
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

  // Start Nostr fallback connections only if the swarm stays sparse.
  scheduleNostrFallback();

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

  // Poll the worklet for the full mesh status (topic/segment counts) alongside
  // the event-driven peer count, so the UI can show live P2P health.
  void refreshSwarmStatus();
  statusPollInterval = setInterval(() => {
    void refreshSwarmStatus();
  }, STATUS_POLL_INTERVAL_MS);
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
  if (statusPollInterval) {
    clearInterval(statusPollInterval);
    statusPollInterval = null;
  }
  if (nostrFallbackTimer) {
    clearTimeout(nostrFallbackTimer);
    nostrFallbackTimer = null;
  }
  nostrInitialized = false;

  disposeTopicManager();
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
  scheduleNostrFallback();
}

/** Fetch the worklet's full mesh status and mirror it into the store. */
async function refreshSwarmStatus(): Promise<void> {
  const status = await getSwarmStatus();
  useTrafficStore.getState().setSwarmStatus(status);
  setTrafficTilePeerCount(status.peerCount);
  updateTrafficMode(status.peerCount);
}

function updateTrafficMode(swarmPeerCount: number): void {
  const mode = swarmPeerCount >= MIN_PEER_THRESHOLD ? 'hyperswarm' : 'nostr';
  useTrafficStore.getState().setTrafficMode(mode);
}

// ── Traffic tile seeding (raster overlay) ───────────────────────────

const SEED_BUMP_THROTTLE_MS = 1_000;
let seedBumpTimer: ReturnType<typeof setTimeout> | null = null;
let seedBumpQueued = false;

/**
 * Cache-bust the raster source so MapLibre re-requests the seeded tiles.
 *
 * Leading edge, then coalesced: the bump fires (or is queued) immediately, so
 * the first tile that lands is painted instead of waiting for the whole
 * viewport batch, and everything that lands inside the following throttle
 * window produces exactly one more bump. The window always closes with a bump
 * if anything arrived during it — the previous throttle simply dropped the
 * event when it fired too soon after the last one, which left those tiles
 * unrendered until the map was panned again.
 */
function scheduleSeedBump(): void {
  if (seedBumpTimer) {
    seedBumpQueued = true;
    return;
  }
  useTrafficStore.getState().bumpTrafficTileSeedVersion();
  seedBumpTimer = setTimeout(() => {
    seedBumpTimer = null;
    if (!seedBumpQueued) return;
    seedBumpQueued = false;
    scheduleSeedBump();
  }, SEED_BUMP_THROTTLE_MS);
}

/**
 * Seed traffic tiles covering the visible viewport through the
 * disk → P2P → TomTom cascade. Bumps the raster source version as tiles land
 * so MapLibre paints progressively rather than all at once.
 *
 * The TomTom seed is skipped for tiles whose area already has saved flow for
 * the current weekday + hour bucket. Without that gate the overlay would keep
 * re-buying tiles on its own 15-minute clock even when the resolution was
 * answered entirely from saved data.
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

  const covered = await readSavedFlowCoverage(
    [...new Set(tiles.map((t) => geohash5For(tileCenter(t).lat, tileCenter(t).lng)))],
    currentSavedFlowBucket(),
    ['segment', 'tile'],
  );

  await ensureTrafficTiles(
    tiles,
    undefined,
    scheduleSeedBump,
    covered.size === 0
      ? {}
      : {
          skipTomTom: (key) => {
            // Only at zooms where a tile is no bigger than a geohash5 cell
            // (~5 km): below that the tile centre's cell does not represent the
            // tile's area, and gating would starve the wide view of coverage.
            if (key.z < 10) return false;
            const center = tileCenter(key);
            return covered.has(geohash5For(center.lat, center.lng));
          },
        },
  );
}

export type { TrafficAreaCondition };
