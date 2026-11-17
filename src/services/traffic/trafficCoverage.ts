import type { TrafficSourceBreakdown } from '../../models/trafficHistory';

/** Explicit traffic coverage status derived from the resolve source. */
export type TrafficCoverage =
  | 'p2p'
  | 'open-feed'
  | 'cold-start'
  | 'local'
  | 'saved'
  | 'stale'
  | 'no-data';

const STALE_AFTER_SEC = 10 * 60;

/** Map a cascade resolve source to a coverage status. */
export function coverageFromResolveSource(source: string | null | undefined): TrafficCoverage {
  switch (source) {
    case 'p2p':
      return 'p2p';
    case 'open_feed':
      return 'open-feed';
    case 'tomtom':
      return 'cold-start';
    case 'saved-flow':
      // Flow this device already fetched for this weekday + hour. Not stale:
      // it is the bucket's answer, which is why the provider was not called.
      return 'saved';
    case 'local-fresh':
    case 'local-history':
      return 'local';
    default:
      return 'no-data';
  }
}

/**
 * Coverage including staleness: data sourced earlier than the stale window is
 * reported as `stale` so the UI can distinguish it from fresh coverage.
 */
export function resolveTrafficCoverage(
  source: string | null | undefined,
  resolvedAtSec: number | null | undefined,
  nowSec: number = Math.floor(Date.now() / 1000),
  staleAfterSec: number = STALE_AFTER_SEC,
): TrafficCoverage {
  const base = coverageFromResolveSource(source);
  if (base === 'no-data') return 'no-data';
  if (resolvedAtSec != null && nowSec - resolvedAtSec > staleAfterSec) return 'stale';
  return base;
}

export const TRAFFIC_COVERAGE_LABELS: Record<TrafficCoverage, string> = {
  p2p: 'Peer network',
  'open-feed': 'Open data',
  'cold-start': 'Cold-start feed',
  local: 'On-device history',
  saved: 'Saved weekday flow',
  stale: 'Stale traffic data',
  'no-data': 'No traffic data',
};

/**
 * One-line provenance summary of a resolution, e.g.
 * `device 12 · tomtom 5 · peers 3 · open 0 · none 2`.
 *
 * The single resolve source answers "which was the highest tier used?", which
 * reads as "everything is TomTom" as soon as one cell needed a cold-start
 * seed. This keeps the split visible instead.
 */
export function summarizeTrafficBreakdown(breakdown: TrafficSourceBreakdown): string {
  if (breakdown.requestedCells <= 0) return '';

  const parts = [`device ${breakdown.localProbe}`];
  if (breakdown.localSeeded > 0) parts.push(`seeded ${breakdown.localSeeded}`);
  parts.push(`tomtom ${breakdown.coldStart}`);
  parts.push(`peers ${breakdown.p2p}`);
  parts.push(`open ${breakdown.openFeed}`);
  if (breakdown.savedFlow > 0) parts.push(`saved ${breakdown.savedFlow}`);
  if (breakdown.unresolved > 0) parts.push(`none ${breakdown.unresolved}`);
  // The paid cost of this resolution. `tomtom N (0 requests)` is the proof
  // that the cold-start cells came from saved data rather than the network.
  parts.push(`requests ${breakdown.providerRequests}`);
  return parts.join(' · ');
}
