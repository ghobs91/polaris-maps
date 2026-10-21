/**
 * WMATA (Washington Metropolitan Area Transit Authority) route lines.
 *
 * Provides route lines + stops for the DC Metro rail system (Red, Orange,
 * Blue, Green, Yellow, Silver).
 *
 * Geometry comes from WMATA's official GTFS static feed, which ships real
 * track shapes (`shapes.txt`).  The `jLines`/`jStations` REST API only
 * returns station coordinates, so deriving geometry from it produces
 * station-to-station straight lines (and, when a line has several code
 * branches, segments joined in the wrong order).  GTFS avoids both.
 *
 * API: https://developer.wmata.com/
 * Key: EXPO_PUBLIC_WMATA_API_KEY (free, 1,000 calls/day)
 */

import type { TransitRouteLine } from '../../models/transit';
import { fetchGtfsStaticLines } from './gtfsStaticFetcher';

const WMATA_GTFS_URL = 'https://api.wmata.com/gtfs/rail-gtfs-static.zip';
const WMATA_LABEL = 'WMATA Washington DC Metro';

function wmataApiKey(): string {
  return (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_WMATA_API_KEY) || '';
}

// ── Cache ─────────────────────────────────────────────────────────────

let cachedLines: TransitRouteLine[] | null = null;
let fetchInFlight: Promise<TransitRouteLine[]> | null = null;

/**
 * Fetch all WMATA Metrorail route lines with geometry and stops.
 *
 * Downloads the official GTFS feed (24 MB, cached in memory + MMKV) and
 * converts it with the shared GTFS parser, then returns the rail lines.
 * Without an API key the feed is unavailable — returning an empty list
 * lets the caller fall back to the DOT registry / OpenStreetMap, whose
 * geometry is accurate.
 */
export async function fetchWmataLines(): Promise<TransitRouteLine[]> {
  if (cachedLines) return cachedLines;
  if (fetchInFlight) return fetchInFlight;

  fetchInFlight = (async (): Promise<TransitRouteLine[]> => {
    const key = wmataApiKey();
    if (!key) return [];

    try {
      const sep = WMATA_GTFS_URL.includes('?') ? '&' : '?';
      const lines = await fetchGtfsStaticLines({
        label: WMATA_LABEL,
        feedUrl: `${WMATA_GTFS_URL}${sep}api_key=${encodeURIComponent(key)}`,
        routeTypeFilter: [1],
        timeoutMs: 60_000,
      });

      cachedLines = lines;
      return lines;
    } catch (err) {
      console.warn('[wmata] GTFS feed failed:', err);
      return [];
    }
  })();

  try {
    return await fetchInFlight;
  } finally {
    fetchInFlight = null;
  }
}

/** Exported for testing. */
export function clearWmataCache(): void {
  cachedLines = null;
  fetchInFlight = null;
}
