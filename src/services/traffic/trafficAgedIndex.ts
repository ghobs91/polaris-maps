import type { NormalizedTrafficSegment } from '../../models/traffic';
import { AgedTrafficStore, InMemoryAgedTrafficBackend } from './trafficAgedStore';
import { SqliteAgedTrafficBackend } from './trafficAgedSqlite';
import { logDiagnostic } from '../diagnostics/diagnosticsLog';

/**
 * Shared instance of the aged traffic store (last-known upstream segments).
 *
 * SQLite in production; falls back to the in-memory backend when the native
 * module is unavailable so the app keeps working (without persistence).
 */
let instance: AgedTrafficStore | null = null;

export function getAgedTraffic(): AgedTrafficStore {
  if (!instance) {
    let backend;
    try {
      backend = new SqliteAgedTrafficBackend();
    } catch {
      backend = new InMemoryAgedTrafficBackend();
    }
    instance = new AgedTrafficStore({ backend });
  }
  return instance;
}

/** Reset the singleton (tests only). */
export function resetAgedTrafficForTests(): void {
  instance = null;
  lastPruneAt = 0;
}

/** Prune the aged table at most this often during a session. */
const PRUNE_INTERVAL_MS = 10 * 60 * 1000;
let lastPruneAt = 0;

/**
 * Persist upstream segments for later fallback use, never throwing into the
 * fetch path. Writes are fire-and-forget: a failed cache is a lost fallback,
 * not a failed resolution.
 *
 * Only provider batches are kept. Probe-derived rows belong to the weekly
 * condition index (they are republishable); this table only ever holds
 * licensed/open upstream content, which stays on the device.
 */
export function recordAgedSegments(segments: NormalizedTrafficSegment[]): void {
  const upstream = segments.filter(
    (segment) => segment.source === 'tomtom' || segment.source === 'open_feed',
  );
  if (upstream.length === 0) return;
  void getAgedTraffic()
    .recordSegments(upstream)
    .then(() => {
      // Retention and the row cap are applied at launch; a long session also
      // needs them, but running the DELETEs on every fetch would be wasteful.
      if (Date.now() - lastPruneAt < PRUNE_INTERVAL_MS) return;
      lastPruneAt = Date.now();
      return getAgedTraffic().prune();
    })
    .catch((error) => {
      logDiagnostic('traffic-aged', 'warn', 'aged traffic write failed', {
        message: error instanceof Error ? error.message : String(error),
        segments: upstream.length,
      });
    });
}

/** Last-known segments young enough to answer a resolution for these cells. */
export async function readAgedSegments(cells: string[]): Promise<NormalizedTrafficSegment[]> {
  try {
    return await getAgedTraffic().getSegments(cells);
  } catch (error) {
    logDiagnostic('traffic-aged', 'warn', 'aged traffic read failed', {
      message: error instanceof Error ? error.message : String(error),
      cells: cells.length,
    });
    return [];
  }
}
