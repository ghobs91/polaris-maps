/**
 * Historical / average traffic condition index types.
 *
 * The index stores traffic conditions per geohash5 area cell (~4.9 km × 4.9 km)
 * per 30-minute time-of-day bucket, keyed by day-of-week so weekday patterns
 * (e.g. Friday 17:30) are distinct from weekend ones.
 */

/** Days are indexed 0 (Sunday) through 6 (Saturday) per JS Date#getDay(). */
export interface TimeBucket {
  dayOfWeek: number;
  /** 30-minute slot of the day: 0 (00:00–00:29) … 47 (23:30–23:59). */
  halfHour: number;
}

/** A single condition observation/aggregate for one cell + bucket. */
export interface TrafficAreaCondition {
  /** geohash5 cell (~4.9 km × 4.9 km). */
  geohash5: string;
  dayOfWeek: number;
  halfHour: number;
  avgSpeedMph: number;
  /** 0–1, currentSpeed / freeFlowSpeed (1 = free flow). */
  avgCongestionRatio: number;
  freeFlowSpeedMph: number;
  /** Number of observations merged into this row (EMA cumulative). */
  sampleCount: number;
  /** Epoch seconds of the most recent observation. */
  lastUpdated: number;
}

/**
 * Compact wire format for P2P condition exchange (matches the probe
 * message style used by the traffic swarm worklet).
 */
export interface WireConditionEntry {
  g: string; // geohash5
  d: number; // dayOfWeek
  h: number; // halfHour
  s: number; // avgSpeedMph
  r: number; // avgCongestionRatio
  f: number; // freeFlowSpeedMph
  n: number; // sampleCount
  u: number; // lastUpdated (epoch seconds)
  /** 1 = observed within the current-fresh window, 0 = historical average. */
  fr: number;
}

/** Where resolved conditions ultimately came from (per request, highest tier used). */
export type TrafficResolveSource = 'local-fresh' | 'local-history' | 'p2p' | 'tomtom' | 'none';

// ── Tunables ─────────────────────────────────────────────────────────

/** Observations this recent count as "current conditions" (15 minutes). */
export const CURRENT_FRESH_SEC = 15 * 60;

/** P2P peers must have observed the bucket within this window to be "fresh". */
export const P2P_FRESH_SEC = 15 * 60;

/** How long to wait for P2P peers to respond to a condition request. */
export const P2P_QUERY_TIMEOUT_MS = 3_500;

/** Minimum observations before a historical average is considered usable. */
export const HISTORICAL_MIN_SAMPLES = 3;

/** Historical rows older than this are considered too stale to use. */
export const HISTORICAL_MAX_AGE_DAYS = 21;

/** Weight given to a new observation when EMA-merging into an existing row. */
export const EMA_ALPHA = 0.35;

/** Cap on cumulative sample count to keep long-lived rows responsive. */
export const MAX_SAMPLE_COUNT = 200;

/** Confidence values assigned to synthesized segments per source tier. */
export const SOURCE_CONFIDENCE: Record<TrafficResolveSource, number> = {
  'local-fresh': 0.85,
  'local-history': 0.6,
  p2p: 0.7,
  tomtom: 0.9,
  none: 0,
};
