import type {
  TimeBucket,
  TrafficAreaCondition,
  TrafficResolveSource,
  WireConditionEntry,
} from '../../models/trafficHistory';
import { SOURCE_CONFIDENCE } from '../../models/trafficHistory';
import type { NormalizedTrafficSegment } from '../../models/traffic';
import { encode as geohashEncode } from '../../utils/geohash';
import { TrafficHistoryService, type ConditionObservation } from './trafficHistoryService';
import { wireToEntry } from './p2pConditionWire';

/**
 * Layered traffic condition resolution.
 *
 * For each requested geohash5 cell (at a given time bucket) data is resolved
 * in this order — each tier only covers cells the earlier tiers missed, so
 * the optional TomTom cold-start bridge is only hit for cells that have no
 * usable local, P2P, or open-feed data:
 *
 *   1. local fresh       — observed within the current-fresh window
 *   2. local historical  — enough samples, within retention window
 *   3. p2p               — fresh data from connected Hyperswarm peers
 *   4. open feed         — free open traffic feed (511 / DATEX II / NDW)
 *   5. tomtom            — optional cold-start seed (also written back into the index)
 */

export interface CascadePoint {
  lat: number;
  lng: number;
  /** geohash5 cell this point falls in. */
  cell: string;
}

export interface CascadeRequest {
  /** Unique cells to resolve, in priority order. */
  cells: string[];
  bucket: TimeBucket;
  /** Sample points used to synthesize route/viewport segments. */
  points: CascadePoint[];
  history: TrafficHistoryService;
  /**
   * Optional free open-feed tier (511 / DATEX II / NDW): returns observed
   * segments for cells still missing. Higher priority than the TomTom
   * cold-start bridge; failures are treated as no data.
   */
  openFeed?: (cells: string[]) => Promise<NormalizedTrafficSegment[]>;
  /**
   * Seed function for the TomTom tier: returns observed segments for the
   * cells that still need data (may return segments for other cells too).
   */
  seedFromTomTom: (cells: string[]) => Promise<NormalizedTrafficSegment[]>;
  /**
   * Indexes TomTom-observed segments into the history index for the current
   * bucket. Provided by the caller so the aggregation policy stays in one place.
   */
  indexObservations: (bucket: TimeBucket, observations: ConditionObservation[]) => Promise<void>;
  /** Request P2P data; injectable for tests. Defaults to the real bridge. */
  p2pQuery?: (cells: string[], bucket: TimeBucket) => Promise<WireConditionEntry[]>;
}
export interface CascadeResult {
  /** Highest tier used to satisfy any cell. */
  source: TrafficResolveSource;
  /** Cell → resolved condition. */
  conditions: Map<string, TrafficAreaCondition>;
  /** Segments synthesized from conditions at the sample points. */
  segments: NormalizedTrafficSegment[];
  /** Cells that no tier could satisfy. */
  unresolvedCells: string[];
}

/** Aggregate a set of observed segments into per-cell condition observations. */
export function observationsFromSegments(
  segments: NormalizedTrafficSegment[],
  cellFor: (lng: number, lat: number) => string,
): Map<string, ConditionObservation> {
  const byCell = new Map<string, NormalizedTrafficSegment[]>();
  for (const seg of segments) {
    const first = seg.coordinates[0];
    if (!first) continue;
    const cell = cellFor(first[0], first[1]);
    const list = byCell.get(cell);
    if (list) {
      list.push(seg);
    } else {
      byCell.set(cell, [seg]);
    }
  }

  const out = new Map<string, ConditionObservation>();
  for (const [cell, cellSegments] of byCell) {
    let speedSum = 0;
    let speedWeight = 0;
    let ratioSum = 0;
    let confidenceSum = 0;
    let freeFlowMax = 0;
    for (const s of cellSegments) {
      const w = Math.max(0.05, s.confidence);
      // `currentSpeedMph: 0` is a "no speed, ratio only" sentinel (tile
      // sampler), not a stopped car. Averaging it as a real speed dilutes a
      // genuine measurement toward zero, and the diluted value is later
      // applied to every route point in the cell.
      if (s.currentSpeedMph > 0) {
        speedSum += s.currentSpeedMph * w;
        speedWeight += w;
      }
      ratioSum += s.congestionRatio * w;
      confidenceSum += w;
      freeFlowMax = Math.max(freeFlowMax, s.freeFlowSpeedMph);
    }
    out.set(cell, {
      geohash5: cell,
      avgSpeedMph: speedWeight > 0 ? speedSum / speedWeight : 0,
      avgCongestionRatio: confidenceSum > 0 ? ratioSum / confidenceSum : 1,
      freeFlowSpeedMph: freeFlowMax,
    });
  }
  return out;
}

/** Synthesize segments from resolved conditions at the sample points. */
export function segmentsFromConditions(
  points: CascadePoint[],
  conditions: Map<string, TrafficAreaCondition>,
  bucket: TimeBucket,
  source: TrafficResolveSource,
): NormalizedTrafficSegment[] {
  const confidence = SOURCE_CONFIDENCE[source] ?? 0.5;
  const segments: NormalizedTrafficSegment[] = [];

  for (const pt of points) {
    const cond = conditions.get(pt.cell);
    if (!cond) continue;
    // A condition is a ~5 km cell average, not a measurement at this point, so
    // it must never be forwarded as `currentSpeedMph` — that would apply a
    // single jam (or a diluted cell average) to every route segment in the
    // cell. The ratio carries the same information and is resolved against the
    // route segment's own free-flow speed by the ETA calculator.
    const ratio =
      cond.avgCongestionRatio > 0
        ? cond.avgCongestionRatio
        : cond.freeFlowSpeedMph > 0
          ? Math.min(1, Math.max(0, cond.avgSpeedMph / cond.freeFlowSpeedMph))
          : 0;

    segments.push({
      id: `hist:${pt.cell}:${bucket.dayOfWeek}:${bucket.halfHour}:${pt.lat.toFixed(4)},${pt.lng.toFixed(4)}`,
      coordinates: [[pt.lng, pt.lat]],
      currentSpeedMph: 0,
      freeFlowSpeedMph: cond.freeFlowSpeedMph,
      congestionRatio: ratio,
      confidence,
      source: 'history',
      timestamp: cond.lastUpdated,
    });
  }

  return segments;
}

/**
 * Resolve conditions for the requested cells using the local → P2P → TomTom
 * cascade. Each tier only fills in cells still missing.
 */
export async function resolveTrafficConditions(req: CascadeRequest): Promise<CascadeResult> {
  const conditions = new Map<string, TrafficAreaCondition>();
  let missing = [...new Set(req.cells)];
  let source: TrafficResolveSource = 'none';

  // Tier 1: local fresh
  if (missing.length > 0) {
    const fresh = await req.history.getFresh(missing, req.bucket);
    const found = new Set(fresh.map((c) => c.geohash5));
    for (const cond of fresh) conditions.set(cond.geohash5, cond);
    missing = missing.filter((c) => !found.has(c));
    if (fresh.length > 0) source = 'local-fresh';
  }

  // Tier 2: local historical average
  if (missing.length > 0) {
    const hist = await req.history.getHistorical(missing, req.bucket);
    const found = new Set(hist.map((c) => c.geohash5));
    for (const cond of hist) conditions.set(cond.geohash5, cond);
    missing = missing.filter((c) => !found.has(c));
    if (hist.length > 0 && source === 'none') source = 'local-history';
  }

  // Tier 3: P2P peers
  if (missing.length > 0) {
    // Default query is lazy-required so this module stays testable without
    // the Bare worklet bridge (which pulls in native modules).
    const query =
      req.p2pQuery ??
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      (require('./trafficP2pQuery') as typeof import('./trafficP2pQuery')).queryPeersForConditions;
    const entries = await query(missing, req.bucket);
    for (const w of entries) {
      const entry = wireToEntry(w);
      await req.history.recordObservation(req.bucket, entry);
      conditions.set(entry.geohash5, entry);
    }
    missing = missing.filter((c) => !conditions.has(c));
    // P2P is a lower tier than the open feed and TomTom cold-start bridge.
    if (entries.length > 0) source = 'p2p';
  }

  // Tier 4: free open traffic feeds (511 / DATEX II / NDW)
  if (missing.length > 0 && typeof req.openFeed === 'function') {
    const segments = await req.openFeed(missing).catch(() => [] as NormalizedTrafficSegment[]);
    if (segments.length > 0) {
      const observations = observationsFromSegments(segments, geohash5ForCoord);
      await req.indexObservations(req.bucket, Array.from(observations.values()));

      let resolvedAny = false;
      for (const [cell, obs] of observations) {
        if (!conditions.has(cell)) {
          conditions.set(cell, {
            geohash5: cell,
            dayOfWeek: req.bucket.dayOfWeek,
            halfHour: req.bucket.halfHour,
            avgSpeedMph: Math.round(obs.avgSpeedMph * 10) / 10,
            avgCongestionRatio: obs.avgCongestionRatio,
            freeFlowSpeedMph: obs.freeFlowSpeedMph,
            sampleCount: 1,
            lastUpdated: Math.floor(Date.now() / 1000),
          });
          resolvedAny = true;
        }
      }
      if (resolvedAny) source = 'open_feed';
      missing = missing.filter((c) => !conditions.has(c));
    }
  }

  // Tier 5: TomTom cold-start seed (optional)
  if (missing.length > 0) {
    const segments = await req.seedFromTomTom(missing);
    if (segments.length > 0) {
      // Index what we observed so future requests hit tiers 1–3.
      const observations = observationsFromSegments(segments, geohash5ForCoord);
      await req.indexObservations(req.bucket, Array.from(observations.values()));
      // TomTom is the highest tier — whenever it ran and found data,
      // that is the authoritative source label for this resolution.
      source = 'tomtom';

      for (const [cell, obs] of observations) {
        if (!conditions.has(cell)) {
          conditions.set(cell, {
            geohash5: cell,
            dayOfWeek: req.bucket.dayOfWeek,
            halfHour: req.bucket.halfHour,
            avgSpeedMph: Math.round(obs.avgSpeedMph * 10) / 10,
            avgCongestionRatio: obs.avgCongestionRatio,
            freeFlowSpeedMph: obs.freeFlowSpeedMph,
            sampleCount: 1,
            lastUpdated: Math.floor(Date.now() / 1000),
          });
        }
      }
      missing = missing.filter((c) => !conditions.has(c));
    }
  }

  return {
    source,
    conditions,
    segments: segmentsFromConditions(req.points, conditions, req.bucket, source),
    unresolvedCells: missing,
  };
}

/** Map a coordinate to its geohash5 cell (independent of the sample points). */
function geohash5ForCoord(lng: number, lat: number): string {
  return geohashEncode(lat, lng, 5);
}
