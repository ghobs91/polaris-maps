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
  /**
   * True when this bucket falls on (or the evening before) a major holiday.
   * Holiday observations are kept out of the regular weekly profile: a
   * Friday 23:30 before New Year's Eve must not be averaged into what a
   * regular Friday 23:30 looks like. Undefined/absent means a regular day.
   */
  holiday?: boolean;
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
  /**
   * How many of the merged observations came from probe-derived sources
   * (own GPS probes, peer probes, peer profiles) rather than licensed
   * upstream seeds (TomTom) or open feeds. Rows that do not meet the
   * probe-share threshold are never republished through shared transports
   * (Nostr relays / Hyperdrives) — upstream traffic content must not be
   * redistributed.
   */
  probeSamples: number;
  /**
   * Days between the row's first and last observation (0 = only ever seen on
   * one day). Publishing requires a span of at least one day so a single
   * drive past a cell cannot be broadcast as a weekly pattern.
   */
  observedSpanDays: number;
  /** UTC day index (epoch days) of the most recent observation. */
  lastObservedDay: number;
  /**
   * True when the row belongs to a major-holiday bucket rather than the
   * regular weekly profile (storage keys them separately). Absent/undefined
   * = regular row.
   */
  holiday?: boolean;
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
  /** Optional: publisher's probe-sample share (see TrafficAreaCondition). */
  p?: number;
  /** 1 = observed on a major holiday (see TimeBucket.holiday). Old peers omit it. */
  ho?: number;
}

/** Where a single condition observation came from. */
export type ConditionObservationSource = 'probe' | 'p2p' | 'nostr' | 'open_feed' | 'tomtom';

/** Observation sources that count toward a row's probe-sample share. */
export const PROBE_DERIVED_SOURCES: readonly ConditionObservationSource[] = [
  'probe',
  'p2p',
  'nostr',
];

/** Where resolved conditions ultimately came from (per request, highest tier used). */
export type TrafficResolveSource =
  | 'local-fresh'
  | 'local-history'
  | 'p2p'
  | 'open_feed'
  | 'tomtom'
  | 'aged'
  | 'none';

/**
 * Per-source cell counts for one resolution.
 *
 * `source` alone cannot answer "was this TomTom or my own flow history?":
 * the cold-start tier only has to satisfy a single cell to become the
 * highest tier used, and the local index can hold rows that were originally
 * seeded from an upstream provider. This breakdown keeps the provenance of
 * each resolved cell so developer-mode UI can show the real mix.
 */
export interface TrafficSourceBreakdown {
  /** Cells the resolution was asked about. */
  requestedCells: number;
  /** Cells answered from local rows that contain probe-derived samples. */
  localProbe: number;
  /** Cells answered from local rows with no probe samples (upstream-seeded). */
  localSeeded: number;
  /** Cells answered by connected peers. */
  p2p: number;
  /** Cells answered by a free open traffic feed. */
  openFeed: number;
  /** Cells answered by the optional TomTom cold-start bridge. */
  coldStart: number;
  /** Cells answered by aged on-device data (last-known, nothing live). */
  aged: number;
  /** Cells no tier could answer. */
  unresolved: number;
}

// ── Tunables ─────────────────────────────────────────────────────────

/** Observations this recent count as "current conditions" (15 minutes). */
export const CURRENT_FRESH_SEC = 15 * 60;

/** P2P peers must have observed the bucket within this window to be "fresh". */
export const P2P_FRESH_SEC = 15 * 60;

/** How long to wait for P2P peers to respond to a condition request. */
export const P2P_QUERY_TIMEOUT_MS = 3_500;

/** Minimum observations before a historical average is considered usable. */
export const HISTORICAL_MIN_SAMPLES = 3;

/**
 * Historical rows older than this are considered too stale to use.
 *
 * A month: flow patterns for a given cell × weekday × time of day change
 * slowly, so rows up to this age are the preferred answer for their bucket —
 * over re-asking an upstream provider for conditions it already answered.
 */
export const HISTORICAL_MAX_AGE_DAYS = 31;

/**
 * How old a holiday row may be and still answer a request.
 *
 * Holidays recur yearly, so last year's Christmas Eve profile is exactly the
 * data wanted this Christmas Eve — a 1-month rule would make holiday data
 * unusable by construction. 400 days covers the same holiday next year
 * (366 for a leap year) plus a few weeks of margin.
 */
export const HOLIDAY_MAX_AGE_DAYS = 400;

/**
 * Minimum observations before a holiday-row average is considered usable.
 *
 * Regular weekly rows need several samples because any single drive can be
 * an outlier. A holiday observation is different: the whole point of the
 * holiday key is that the day is atypical, and the next chance to observe
 * the same bucket is a year away — so one observation is enough to serve.
 */
export const HISTORICAL_MIN_SAMPLES_HOLIDAY = 1;

/** Weight given to a new observation when EMA-merging into an existing row. */
export const EMA_ALPHA = 0.35;

/** Cap on cumulative sample count to keep long-lived rows responsive. */
export const MAX_SAMPLE_COUNT = 200;

/**
 * Minimum probe-derived observations before a historical row may be
 * republished through shared transports (Nostr relays / Hyperdrives).
 * Rows below this are treated as potentially upstream-seeded and stay local.
 */
export const MIN_PROBE_SAMPLES_FOR_PUBLISH = 5;

/** Confidence values assigned to synthesized segments per source tier. */
export const SOURCE_CONFIDENCE: Record<TrafficResolveSource, number> = {
  'local-fresh': 0.85,
  'local-history': 0.6,
  p2p: 0.7,
  open_feed: 0.75,
  tomtom: 0.9,
  // Last resort: the data is real, but it can be up to `AGED_MAX_AGE_SEC` old
  // and must lose a confidence-weighted merge against any live source.
  aged: 0.3,
  none: 0,
};
