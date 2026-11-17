import type { NormalizedTrafficSegment, SavedFlowKind } from '../../models/traffic';
import {
  InMemorySavedFlowBackend,
  SavedFlowStore,
  upstreamSourceOnly,
} from './trafficSavedFlowStore';
import { SqliteSavedFlowBackend } from './trafficSavedFlowSqlite';
import type { SavedFlowBucket } from './savedFlowBucket';
import { currentSavedFlowBucket, savedFlowBucketFromHalfHour } from './savedFlowBucket';
import { logDiagnostic } from '../diagnostics/diagnosticsLog';
import { encode as geohashEncode } from '../../utils/geohash';

/**
 * Shared instance of the saved-upstream-flow store (weekday × hour buckets).
 *
 * SQLite in production; falls back to the in-memory backend when the native
 * module is unavailable so the app keeps working (without persistence).
 */
let instance: SavedFlowStore | null = null;

export function getSavedFlow(): SavedFlowStore {
  if (!instance) {
    let backend;
    try {
      backend = new SqliteSavedFlowBackend();
    } catch {
      backend = new InMemorySavedFlowBackend();
    }
    instance = new SavedFlowStore({ backend });
  }
  return instance;
}

/** Reset the singleton (tests only). */
export function resetSavedFlowForTests(): void {
  instance = null;
  lastPruneAt = 0;
}

/** Prune the table at most this often during a session. */
const PRUNE_INTERVAL_MS = 10 * 60 * 1000;
let lastPruneAt = 0;

/**
 * Persist an upstream batch under the bucket it was observed in, never
 * throwing into the fetch path. Writes are fire-and-forget: a failed cache is a
 * lost saving, not a failed resolution.
 *
 * Only provider batches are kept. Probe-derived rows belong to the weekly
 * condition index (they are republishable); this table only ever holds
 * licensed/open upstream content, which stays on the device.
 */
export function recordSavedFlow(
  segments: NormalizedTrafficSegment[],
  kind: SavedFlowKind,
  bucket: SavedFlowBucket = currentSavedFlowBucket(),
): void {
  const upstream = segments.filter(upstreamSourceOnly);
  if (upstream.length === 0) return;
  void getSavedFlow()
    .recordSegments(upstream, bucket, kind)
    .then(() => {
      // Retention and the row cap are applied at launch; a long session also
      // needs them, but running the DELETEs on every fetch would be wasteful.
      if (Date.now() - lastPruneAt < PRUNE_INTERVAL_MS) return;
      lastPruneAt = Date.now();
      return getSavedFlow().prune();
    })
    .catch((error) => {
      logDiagnostic('traffic-saved-flow', 'warn', 'saved flow write failed', {
        message: error instanceof Error ? error.message : String(error),
        segments: upstream.length,
      });
    });
}

/** Saved segments for these cells in this weekday × hour bucket. */
export async function readSavedFlow(
  cells: string[],
  bucket: SavedFlowBucket,
  kinds: SavedFlowKind[],
): Promise<NormalizedTrafficSegment[]> {
  try {
    return await getSavedFlow().getSegments(cells, bucket, kinds);
  } catch (error) {
    logDiagnostic('traffic-saved-flow', 'warn', 'saved flow read failed', {
      message: error instanceof Error ? error.message : String(error),
      cells: cells.length,
    });
    return [];
  }
}

/** Which of these cells already have saved flow for the bucket. */
export async function readSavedFlowCoverage(
  cells: string[],
  bucket: SavedFlowBucket,
  kinds: SavedFlowKind[],
): Promise<Set<string>> {
  try {
    return await getSavedFlow().coveredCells(cells, bucket, kinds);
  } catch {
    return new Set();
  }
}

/**
 * Does this device already hold saved flow covering the route's cells for the
 * current weekday + hour bucket?
 *
 * Callers use this to avoid a paid route-ETA request for a route whose traffic
 * is already on the device. Returns false when nothing covers it, so the
 * provider is still asked for genuinely new areas.
 */
export async function hasSavedFlowForRoute(
  routeCoords: [number, number][],
  sampleEveryDeg = 0.02,
  kinds: SavedFlowKind[] = ['segment', 'tile'],
): Promise<boolean> {
  const cells = routeCells(routeCoords, sampleEveryDeg);
  if (cells.length === 0) return false;
  const covered = await readSavedFlowCoverage(cells, currentSavedFlowBucket(), kinds);
  if (covered.size === 0) return false;
  // Require most of the route to be covered before skipping the provider: a
  // single saved cell at the origin is not "the route is already known".
  return covered.size / cells.length >= 0.5;
}

/** Unique geohash5 cells along a route polyline (sampled, not every vertex). */
export function routeCells(
  routeCoords: [number, number][],
  sampleEveryDeg: number = 0.02,
): string[] {
  const cells = new Set<string>();
  let lastLng = Number.NaN;
  let lastLat = Number.NaN;
  for (const [lng, lat] of routeCoords) {
    if (
      Number.isFinite(lastLng) &&
      (lng - lastLng) * (lng - lastLng) + (lat - lastLat) * (lat - lastLat) <
        sampleEveryDeg * sampleEveryDeg
    ) {
      continue;
    }
    lastLng = lng;
    lastLat = lat;
    cells.add(geohashEncode(lat, lng, 5));
  }
  return [...cells];
}

/**
 * Bucket for a cascade request (`TimeBucket` uses 30-minute slots; saved flow
 * is keyed by hour, rounded down so it matches the hour the caller observed in).
 */
export function savedFlowBucketForRequest(bucket: {
  dayOfWeek: number;
  halfHour: number;
}): SavedFlowBucket {
  return savedFlowBucketFromHalfHour(bucket.dayOfWeek, bucket.halfHour);
}
