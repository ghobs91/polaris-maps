import type { WireConditionEntry } from '../../models/trafficHistory';

/**
 * Pure serialization between local condition rows and the compact wire
 * format used for P2P condition exchange. No native imports — safe for
 * unit tests and the Bare worklet's JS subset.
 */

export interface WireConditionSource {
  geohash5: string;
  dayOfWeek: number;
  halfHour: number;
  avgSpeedMph: number;
  avgCongestionRatio: number;
  freeFlowSpeedMph: number;
  sampleCount: number;
  lastUpdated: number;
}

/** Serialize a local condition row into the compact P2P wire format. */
export function conditionToWire(entry: WireConditionSource, fresh: boolean): WireConditionEntry {
  return {
    g: entry.geohash5,
    d: entry.dayOfWeek,
    h: entry.halfHour,
    s: entry.avgSpeedMph,
    r: entry.avgCongestionRatio,
    f: entry.freeFlowSpeedMph,
    n: entry.sampleCount,
    u: entry.lastUpdated,
    fr: fresh ? 1 : 0,
  };
}

/** Deserialize a wire entry back into a condition row shape. */
export function wireToEntry(w: WireConditionEntry): WireConditionSource {
  return {
    geohash5: w.g,
    dayOfWeek: w.d,
    halfHour: w.h,
    avgSpeedMph: w.s,
    avgCongestionRatio: w.r,
    freeFlowSpeedMph: w.f,
    sampleCount: w.n,
    lastUpdated: w.u,
  };
}
