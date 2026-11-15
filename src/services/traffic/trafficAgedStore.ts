import type { NormalizedTrafficSegment } from '../../models/traffic';
import { encode as geohashEncode } from '../../utils/geohash';

/**
 * Last-known upstream traffic segments, persisted on device.
 *
 * The live cascade (probes → peers → open feed → TomTom) only ever answers the
 * *current* request. This store keeps the road-level answers the device has
 * already paid for — a TomTom flow response or an open-feed batch carries real
 * segments with speed and free-flow speed, not just a cell average — so a
 * route checked later in the same area has *something* instead of an empty
 * overlay when every live tier comes back empty (no key, breaker open, no
 * peers, no feed coverage).
 *
 * It is deliberately the weakest tier:
 *
 *   - it is ranked below every live tier and below the TomTom bridge, so it
 *     can only answer cells nothing live resolved;
 *   - it is served with a hard age limit (`AGED_MAX_AGE_SEC`), and the
 *     resolution is labelled `stale` in the UI instead of pretending to be
 *     current traffic;
 *   - the row's own observation time (`NormalizedTrafficSegment.timestamp`)
 *     is the age, never the write time — re-caching a 15-minute-old seed must
 *     not make it look fresh;
 *   - rows are never published to peers and never counted as probe samples:
 *     licensed upstream content stays local.
 */

/** How old a stored segment may be and still answer a resolution. */
export const AGED_MAX_AGE_SEC = 2 * 60 * 60;
/** Hard retention: rows older than this are deleted. */
export const AGED_RETENTION_SEC = 6 * 60 * 60;
/** Row cap so a long session cannot grow the table without bound. */
export const AGED_MAX_ROWS = 20_000;

/** One persisted segment, keyed by the geohash5 cell of its first point. */
export interface AgedTrafficRow {
  cell: string;
  segmentId: string;
  coordinates: [number, number][];
  source: NormalizedTrafficSegment['source'];
  currentSpeedMph: number;
  freeFlowSpeedMph: number;
  congestionRatio: number;
  confidence: number;
  /** Epoch seconds the segment was observed by the provider. */
  observedAt: number;
}

/** Storage backend (SQLite in production, in-memory in tests). */
export interface AgedTrafficBackend {
  init(): Promise<void>;
  /** Insert rows, keeping whichever copy was observed most recently. */
  upsert(rows: AgedTrafficRow[]): Promise<void>;
  getByCells(cells: string[], minObservedAt: number): Promise<AgedTrafficRow[]>;
  deleteOlderThan(cutoff: number): Promise<number>;
  /** Keep only the newest `maxRows` rows. */
  enforceRowCap(maxRows: number): Promise<number>;
  count(): Promise<number>;
  close(): Promise<void>;
}

/** geohash5 cell (~4.9 km) of a segment's first coordinate, or null. */
export function agedCellForSegment(seg: NormalizedTrafficSegment): string | null {
  const first = seg.coordinates[0];
  if (!first) return null;
  return geohashEncode(first[1], first[0], 5);
}

/** Convert segments into rows, dropping any without usable geometry. */
export function agedRowsFromSegments(
  segments: NormalizedTrafficSegment[],
  nowSec: number,
): AgedTrafficRow[] {
  const rows: AgedTrafficRow[] = [];
  for (const seg of segments) {
    const cell = agedCellForSegment(seg);
    if (!cell) continue;
    if (!Number.isFinite(seg.congestionRatio)) continue;
    rows.push({
      cell,
      segmentId: seg.id,
      coordinates: seg.coordinates,
      source: seg.source,
      currentSpeedMph: seg.currentSpeedMph,
      freeFlowSpeedMph: seg.freeFlowSpeedMph,
      congestionRatio: Math.min(1, Math.max(0, seg.congestionRatio)),
      confidence: seg.confidence,
      // The provider's observation time, not the write time: re-caching an old
      // seed must not reset its age.
      observedAt: Number.isFinite(seg.timestamp) ? seg.timestamp : nowSec,
    });
  }
  return rows;
}

/** Rebuild segments from rows (already age-filtered by the backend query). */
export function agedSegmentsFromRows(rows: AgedTrafficRow[]): NormalizedTrafficSegment[] {
  return rows.map((row) => ({
    id: row.segmentId,
    coordinates: row.coordinates,
    currentSpeedMph: row.currentSpeedMph,
    freeFlowSpeedMph: row.freeFlowSpeedMph,
    congestionRatio: row.congestionRatio,
    confidence: row.confidence,
    source: row.source,
    timestamp: row.observedAt,
  }));
}

export interface AgedTrafficStoreOptions {
  backend: AgedTrafficBackend;
  /** Clock override (epoch seconds). */
  now?: () => number;
  maxAgeSec?: number;
  retentionSec?: number;
  maxRows?: number;
}

/**
 * Service over the aged backend. Query policy (age limit, retention, cap)
 * lives here so the backends stay thin.
 */
export class AgedTrafficStore {
  private readonly backend: AgedTrafficBackend;
  private readonly now: () => number;
  private readonly maxAgeSec: number;
  private readonly retentionSec: number;
  private readonly maxRows: number;
  private ready: Promise<void> | null = null;

  constructor(opts: AgedTrafficStoreOptions) {
    this.backend = opts.backend;
    this.now = opts.now ?? (() => Math.floor(Date.now() / 1000));
    this.maxAgeSec = opts.maxAgeSec ?? AGED_MAX_AGE_SEC;
    this.retentionSec = opts.retentionSec ?? AGED_RETENTION_SEC;
    this.maxRows = opts.maxRows ?? AGED_MAX_ROWS;
  }

  init(): Promise<void> {
    if (!this.ready) {
      this.ready = this.backend.init();
    }
    return this.ready;
  }

  /** Persist freshly fetched upstream segments. Returns the rows written. */
  async recordSegments(segments: NormalizedTrafficSegment[]): Promise<number> {
    if (segments.length === 0) return 0;
    await this.init();
    const rows = agedRowsFromSegments(segments, this.now());
    if (rows.length === 0) return 0;
    await this.backend.upsert(rows);
    return rows.length;
  }

  /** Segments young enough to answer a resolution, for the given cells. */
  async getSegments(cells: string[]): Promise<NormalizedTrafficSegment[]> {
    const unique = [...new Set(cells)];
    if (unique.length === 0) return [];
    await this.init();
    const rows = await this.backend.getByCells(unique, this.now() - this.maxAgeSec);
    return agedSegmentsFromRows(rows);
  }

  /** Delete expired rows and trim to the row cap. Returns rows removed. */
  async prune(): Promise<number> {
    await this.init();
    const expired = await this.backend.deleteOlderThan(this.now() - this.retentionSec);
    const trimmed = await this.backend.enforceRowCap(this.maxRows);
    return expired + trimmed;
  }

  async count(): Promise<number> {
    await this.init();
    return this.backend.count();
  }

  async close(): Promise<void> {
    await this.backend.close();
  }
}

/** In-memory backend — unit tests and the no-SQLite fallback path. */
export class InMemoryAgedTrafficBackend implements AgedTrafficBackend {
  private rows = new Map<string, AgedTrafficRow>();

  async init(): Promise<void> {}

  async upsert(rows: AgedTrafficRow[]): Promise<void> {
    for (const row of rows) {
      const key = `${row.cell}|${row.segmentId}`;
      const existing = this.rows.get(key);
      if (existing && existing.observedAt > row.observedAt) continue;
      this.rows.set(key, row);
    }
  }

  async getByCells(cells: string[], minObservedAt: number): Promise<AgedTrafficRow[]> {
    const wanted = new Set(cells);
    return [...this.rows.values()].filter(
      (row) => wanted.has(row.cell) && row.observedAt >= minObservedAt,
    );
  }

  async deleteOlderThan(cutoff: number): Promise<number> {
    let removed = 0;
    for (const [key, row] of this.rows) {
      if (row.observedAt < cutoff) {
        this.rows.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  async enforceRowCap(maxRows: number): Promise<number> {
    if (this.rows.size <= maxRows) return 0;
    const newestFirst = [...this.rows.entries()].sort((a, b) => b[1].observedAt - a[1].observedAt);
    let removed = 0;
    for (const [key] of newestFirst.slice(maxRows)) {
      this.rows.delete(key);
      removed += 1;
    }
    return removed;
  }

  async count(): Promise<number> {
    return this.rows.size;
  }

  async close(): Promise<void> {
    this.rows.clear();
  }
}
