import type { TimeBucket, TrafficAreaCondition } from '../../models/trafficHistory';
import {
  CURRENT_FRESH_SEC,
  EMA_ALPHA,
  HISTORICAL_MIN_SAMPLES,
  HISTORICAL_MAX_AGE_DAYS,
  MAX_SAMPLE_COUNT,
} from '../../models/trafficHistory';

/**
 * Storage backend for the historical/average traffic condition index.
 *
 * Implemented by the SQLite backend (production) and an in-memory backend
 * (tests). All query semantics live in {@link TrafficHistoryService} so the
 * backends stay thin.
 */
export interface TrafficHistoryBackend {
  /** Create the underlying store if needed. */
  init(): Promise<void>;
  /** Insert a new row or return the existing row for the key. */
  insert(condition: TrafficAreaCondition): Promise<void>;
  /** Replace an existing row. */
  update(condition: TrafficAreaCondition): Promise<void>;
  /** Fetch rows for the given cells/bucket. */
  getByKey(cells: string[], bucket: TimeBucket): Promise<TrafficAreaCondition[]>;
  /** Fetch all rows (for pruning). */
  getAll(): Promise<TrafficAreaCondition[]>;
  /** Delete a single row by key. */
  remove(cell: string, bucket: TimeBucket): Promise<void>;
  /** Total row count. */
  count(): Promise<number>;
  /** Close the underlying store (if applicable). */
  close(): Promise<void>;
}

export interface TrafficHistoryOptions {
  backend: TrafficHistoryBackend;
  /** Overrides for tests: seconds an observation stays "current-fresh". */
  freshSec?: number;
  /** Overrides for tests: max age (days) for historical rows. */
  historicalMaxAgeDays?: number;
  /** Overrides for tests: minimum samples for a usable historical row. */
  minHistoricalSamples?: number;
  /** Overrides for tests: EMA weight for new observations. */
  emaAlpha?: number;
  /** Overrides for tests: fixed "now" (epoch seconds). */
  now?: () => number;
}

/**
 * Merge a new observation into an existing condition row using exponential
 * moving averages for speed and ratio. Returns the merged row.
 *
 * Pure function — unit tested directly.
 */
export function mergeConditionObservation(
  existing: TrafficAreaCondition,
  observation: { avgSpeedMph: number; avgCongestionRatio: number; freeFlowSpeedMph: number },
  nowSec: number,
  alpha: number = EMA_ALPHA,
): TrafficAreaCondition {
  return {
    ...existing,
    avgSpeedMph: round1(existing.avgSpeedMph * (1 - alpha) + observation.avgSpeedMph * alpha),
    avgCongestionRatio: clamp(
      existing.avgCongestionRatio * (1 - alpha) + observation.avgCongestionRatio * alpha,
      0,
      1,
    ),
    freeFlowSpeedMph: Math.max(existing.freeFlowSpeedMph, observation.freeFlowSpeedMph),
    sampleCount: Math.min(MAX_SAMPLE_COUNT, existing.sampleCount + 1),
    lastUpdated: nowSec,
  };
}

export interface ConditionObservation {
  geohash5: string;
  avgSpeedMph: number;
  avgCongestionRatio: number;
  freeFlowSpeedMph: number;
}

export class TrafficHistoryService {
  private readonly backend: TrafficHistoryBackend;
  private readonly freshSec: number;
  private readonly historicalMaxAgeDays: number;
  private readonly minHistoricalSamples: number;
  private readonly emaAlpha: number;
  private readonly nowFn: () => number;
  private ready: Promise<void> | null = null;

  constructor(opts: TrafficHistoryOptions) {
    this.backend = opts.backend;
    this.freshSec = opts.freshSec ?? CURRENT_FRESH_SEC;
    this.historicalMaxAgeDays = opts.historicalMaxAgeDays ?? HISTORICAL_MAX_AGE_DAYS;
    this.minHistoricalSamples = opts.minHistoricalSamples ?? HISTORICAL_MIN_SAMPLES;
    this.emaAlpha = opts.emaAlpha ?? EMA_ALPHA;
    this.nowFn = opts.now ?? (() => Math.floor(Date.now() / 1000));
  }

  /** Initialize the backend once (idempotent). */
  init(): Promise<void> {
    if (!this.ready) {
      this.ready = this.backend.init();
    }
    return this.ready;
  }

  /**
   * Record a condition observation for a cell at a time bucket.
   * If the row already exists, EMA-merge into it; otherwise insert.
   */
  async recordObservation(bucket: TimeBucket, obs: ConditionObservation): Promise<void> {
    await this.init();
    const now = this.nowFn();
    const existing = (await this.backend.getByKey([obs.geohash5], bucket))[0];

    if (existing) {
      await this.backend.update(mergeConditionObservation(existing, obs, now, this.emaAlpha));
    } else {
      await this.backend.insert({
        geohash5: obs.geohash5,
        dayOfWeek: bucket.dayOfWeek,
        halfHour: bucket.halfHour,
        avgSpeedMph: round1(obs.avgSpeedMph),
        avgCongestionRatio: clamp(obs.avgCongestionRatio, 0, 1),
        freeFlowSpeedMph: obs.freeFlowSpeedMph,
        sampleCount: 1,
        lastUpdated: now,
      });
    }
  }

  /** Bulk-record observations (single init). */
  async recordObservations(
    bucket: TimeBucket,
    observations: ConditionObservation[],
  ): Promise<void> {
    await this.init();
    for (const obs of observations) {
      await this.recordObservation(bucket, obs);
    }
  }

  /**
   * Fetch rows observed within the current-fresh window for the given
   * cells + bucket. These represent "what traffic looks like right now".
   */
  async getFresh(cells: string[], bucket: TimeBucket): Promise<TrafficAreaCondition[]> {
    await this.init();
    const cutoff = this.nowFn() - this.freshSec;
    const rows = await this.backend.getByKey(cells, bucket);
    return rows.filter((r) => r.lastUpdated >= cutoff);
  }

  /**
   * Fetch historical-average rows for the given cells + bucket: enough
   * samples and not older than the retention window. Includes rows that
   * are also fresh (callers check fresh first).
   */
  async getHistorical(cells: string[], bucket: TimeBucket): Promise<TrafficAreaCondition[]> {
    await this.init();
    const cutoff = this.nowFn() - this.historicalMaxAgeDays * 86_400;
    const rows = await this.backend.getByKey(cells, bucket);
    return rows.filter(
      (r) => r.lastUpdated >= cutoff && r.sampleCount >= this.minHistoricalSamples,
    );
  }

  /** Remove rows older than the retention window. */
  async prune(): Promise<number> {
    await this.init();
    const cutoff = this.nowFn() - this.historicalMaxAgeDays * 86_400;
    const rows = await this.backend.getAll();
    let removed = 0;
    for (const row of rows) {
      if (row.lastUpdated < cutoff) {
        await this.backend.remove(row.geohash5, {
          dayOfWeek: row.dayOfWeek,
          halfHour: row.halfHour,
        });
        removed++;
      }
    }
    return removed;
  }

  async count(): Promise<number> {
    await this.init();
    return this.backend.count();
  }

  async close(): Promise<void> {
    await this.backend.close();
  }
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
