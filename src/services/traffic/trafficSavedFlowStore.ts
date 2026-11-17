import type { NormalizedTrafficSegment, SavedFlowKind } from '../../models/traffic';
import { SAVED_FLOW_MAX_AGE_DAYS } from '../../models/trafficHistory';
import type { SavedFlowBucket } from './savedFlowBucket';
import { encode as geohashEncode } from '../../utils/geohash';

/**
 * Saved upstream flow, keyed by weekday + hour.
 *
 * The rule this store implements: any flow data this device has already seen
 * for a weekday and hour block answers later requests in that same block, for
 * up to a month — no provider call. TomTom is asked only when nothing is saved
 * for the block, and whatever it returns is saved under that block.
 *
 * Two properties matter as much as the key:
 *
 *   - **Granularity.** Rows record how fine-grained the observation was
 *     (`SavedFlowKind`): a real road segment (speed + free-flow) or a point
 *     sample read off a raster tile (ratio only). A request that needs road
 *     segments is never answered with tile point-samples.
 *   - **Local only.** Rows are licensed upstream content: they are never
 *     published to peers and never counted as probe samples, so they can never
 *     be replayed as if the device had observed the traffic itself.
 */

/** How old a saved row may be and still answer its bucket. */
export const SAVED_FLOW_MAX_AGE_SEC = SAVED_FLOW_MAX_AGE_DAYS * 86_400;
/** Hard retention for rows (same window — nothing is served past it anyway). */
export const SAVED_FLOW_RETENTION_SEC = SAVED_FLOW_MAX_AGE_DAYS * 86_400;
/** Row cap so a long-lived install cannot grow the table without bound. */
export const SAVED_FLOW_MAX_ROWS = 50_000;

/** One persisted segment for a weekday × hour bucket. */
export interface SavedFlowRow {
  /** geohash5 cell of the segment's first coordinate. */
  cell: string;
  dayOfWeek: number;
  hour: number;
  kind: SavedFlowKind;
  segmentId: string;
  coordinates: [number, number][];
  source: NormalizedTrafficSegment['source'];
  currentSpeedMph: number;
  freeFlowSpeedMph: number;
  congestionRatio: number;
  confidence: number;
  /** Epoch seconds the provider observed it. */
  observedAt: number;
}

/** Storage backend (SQLite in production, in-memory in tests). */
export interface SavedFlowBackend {
  init(): Promise<void>;
  /** Insert rows, keeping the newest observation per key. */
  upsert(rows: SavedFlowRow[]): Promise<void>;
  getByBucket(
    cells: string[],
    dayOfWeek: number,
    hour: number,
    kinds: SavedFlowKind[],
    minObservedAt: number,
  ): Promise<SavedFlowRow[]>;
  deleteOlderThan(cutoff: number): Promise<number>;
  enforceRowCap(maxRows: number): Promise<number>;
  count(): Promise<number>;
  close(): Promise<void>;
}

/** geohash5 cell (~4.9 km) of a segment's first coordinate, or null. */
export function savedFlowCellForSegment(seg: NormalizedTrafficSegment): string | null {
  const first = seg.coordinates[0];
  if (!first) return null;
  return geohashEncode(first[1], first[0], 5);
}

/**
 * Convert segments into rows for one bucket.
 *
 * `observedAt` is the provider's observation time, never the write time, so
 * re-saving a replay cannot make old data look current.
 */
export function savedFlowRowsFromSegments(
  segments: NormalizedTrafficSegment[],
  bucket: SavedFlowBucket,
  kind: SavedFlowKind,
  nowSec: number,
): SavedFlowRow[] {
  const rows: SavedFlowRow[] = [];
  for (const seg of segments) {
    const cell = savedFlowCellForSegment(seg);
    if (!cell) continue;
    if (!Number.isFinite(seg.congestionRatio)) continue;
    rows.push({
      cell,
      dayOfWeek: bucket.dayOfWeek,
      hour: bucket.hour,
      kind,
      segmentId: seg.id,
      coordinates: seg.coordinates,
      source: seg.source,
      currentSpeedMph: seg.currentSpeedMph,
      freeFlowSpeedMph: seg.freeFlowSpeedMph,
      congestionRatio: Math.min(1, Math.max(0, seg.congestionRatio)),
      confidence: seg.confidence,
      observedAt: Number.isFinite(seg.timestamp) ? seg.timestamp : nowSec,
    });
  }
  return rows;
}

/** Rebuild segments from rows (already age/kind filtered by the query). */
export function savedFlowSegmentsFromRows(rows: SavedFlowRow[]): NormalizedTrafficSegment[] {
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

/** Only provider batches are saved; probe-derived data belongs to the index. */
export function upstreamSourceOnly(seg: NormalizedTrafficSegment): boolean {
  return seg.source === 'tomtom' || seg.source === 'open_feed';
}

export interface SavedFlowStoreOptions {
  backend: SavedFlowBackend;
  /** Clock override (epoch seconds). */
  now?: () => number;
  maxAgeSec?: number;
  retentionSec?: number;
  maxRows?: number;
}

/**
 * Service over the saved-flow backend. Query policy (age limit, retention,
 * cap) lives here so backends stay thin.
 */
export class SavedFlowStore {
  private readonly backend: SavedFlowBackend;
  private readonly now: () => number;
  private readonly maxAgeSec: number;
  private readonly retentionSec: number;
  private readonly maxRows: number;
  private ready: Promise<void> | null = null;

  constructor(opts: SavedFlowStoreOptions) {
    this.backend = opts.backend;
    this.now = opts.now ?? (() => Math.floor(Date.now() / 1000));
    this.maxAgeSec = opts.maxAgeSec ?? SAVED_FLOW_MAX_AGE_SEC;
    this.retentionSec = opts.retentionSec ?? SAVED_FLOW_RETENTION_SEC;
    this.maxRows = opts.maxRows ?? SAVED_FLOW_MAX_ROWS;
  }

  init(): Promise<void> {
    if (!this.ready) {
      this.ready = this.backend.init();
    }
    return this.ready;
  }

  /** Persist upstream segments under the bucket they were observed in. */
  async recordSegments(
    segments: NormalizedTrafficSegment[],
    bucket: SavedFlowBucket,
    kind: SavedFlowKind,
  ): Promise<number> {
    if (segments.length === 0) return 0;
    await this.init();
    const rows = savedFlowRowsFromSegments(segments, bucket, kind, this.now());
    if (rows.length === 0) return 0;
    await this.backend.upsert(rows);
    return rows.length;
  }

  /**
   * Saved segments for these cells in this weekday × hour bucket.
   * `kinds` is the set the caller can use — a road-segment request must not be
   * answered with tile point-samples.
   */
  async getSegments(
    cells: string[],
    bucket: SavedFlowBucket,
    kinds: SavedFlowKind[],
  ): Promise<NormalizedTrafficSegment[]> {
    const unique = [...new Set(cells)];
    if (unique.length === 0 || kinds.length === 0) return [];
    await this.init();
    const rows = await this.backend.getByBucket(
      unique,
      bucket.dayOfWeek,
      bucket.hour,
      kinds,
      this.now() - this.maxAgeSec,
    );
    return savedFlowSegmentsFromRows(rows);
  }

  /** Which of these cells have saved flow for the bucket (cheap coverage check). */
  async coveredCells(
    cells: string[],
    bucket: SavedFlowBucket,
    kinds: SavedFlowKind[],
  ): Promise<Set<string>> {
    const segments = await this.getSegments(cells, bucket, kinds);
    const covered = new Set<string>();
    for (const seg of segments) {
      const cell = savedFlowCellForSegment(seg);
      if (cell) covered.add(cell);
    }
    return covered;
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
export class InMemorySavedFlowBackend implements SavedFlowBackend {
  private rows = new Map<string, SavedFlowRow>();

  async init(): Promise<void> {}

  async upsert(rows: SavedFlowRow[]): Promise<void> {
    for (const row of rows) {
      const key = keyOf(row);
      const existing = this.rows.get(key);
      if (existing && existing.observedAt > row.observedAt) continue;
      this.rows.set(key, row);
    }
  }

  async getByBucket(
    cells: string[],
    dayOfWeek: number,
    hour: number,
    kinds: SavedFlowKind[],
    minObservedAt: number,
  ): Promise<SavedFlowRow[]> {
    const wanted = new Set(cells);
    const kindSet = new Set(kinds);
    const out: SavedFlowRow[] = [];
    for (const row of this.rows.values()) {
      if (!wanted.has(row.cell)) continue;
      if (row.dayOfWeek !== dayOfWeek || row.hour !== hour) continue;
      if (!kindSet.has(row.kind)) continue;
      if (row.observedAt < minObservedAt) continue;
      out.push(row);
    }
    return out;
  }

  async deleteOlderThan(cutoff: number): Promise<number> {
    let removed = 0;
    for (const [key, row] of this.rows) {
      if (row.observedAt < cutoff) {
        this.rows.delete(key);
        removed++;
      }
    }
    return removed;
  }

  async enforceRowCap(maxRows: number): Promise<number> {
    if (this.rows.size <= maxRows) return 0;
    const sorted = [...this.rows.entries()].sort((a, b) => b[1].observedAt - a[1].observedAt);
    let removed = 0;
    for (const [key] of sorted.slice(maxRows)) {
      this.rows.delete(key);
      removed++;
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

function keyOf(row: SavedFlowRow): string {
  return `${row.cell}|${row.dayOfWeek}|${row.hour}|${row.kind}|${row.segmentId}`;
}
