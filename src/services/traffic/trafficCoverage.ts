/** Explicit traffic coverage status derived from the resolve source. */
export type TrafficCoverage = 'p2p' | 'open-feed' | 'cold-start' | 'local' | 'stale' | 'no-data';

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
  stale: 'Stale traffic data',
  'no-data': 'No traffic data',
};
