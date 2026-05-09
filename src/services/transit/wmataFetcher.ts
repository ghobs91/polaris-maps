/**
 * WMATA (Washington Metropolitan Area Transit Authority) API fetcher.
 *
 * Provides route lines + stops for the DC Metro rail system (Red, Orange,
 * Blue, Green, Yellow, Silver).
 *
 * API: https://developer.wmata.com/
 * Key: EXPO_PUBLIC_WMATA_API_KEY (free, 1,000 calls/day)
 */

import type { TransitMode, TransitRouteLine, TransitRouteLineStop } from '../../models/transit';

const WMATA_BASE = 'https://api.wmata.com/Rail.svc/json';
const FETCH_TIMEOUT_MS = 20_000;

function wmataApiKey(): string {
  return (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_WMATA_API_KEY) || '';
}

function wmataUrl(path: string): string {
  const key = wmataApiKey();
  const sep = path.includes('?') ? '&' : '?';
  return `${WMATA_BASE}/${path}${sep}api_key=${key}`;
}

// ── WMATA line number → colour (official WMATA colours) ──────────────

const WMATA_LINE_COLORS: Record<string, string> = {
  RD: 'BF0D3E',
  OR: 'ED8B00',
  BL: '0076C0',
  YL: 'F9E300',
  GR: '00B050',
  SV: '919D9D',
};

// ── Types ─────────────────────────────────────────────────────────────

interface WmataLine {
  LineCode: string;
  DisplayName: string;
  InternalDestination1?: string;
  InternalDestination2?: string;
}

interface WmataStation {
  Code: string;
  Name: string;
  Lat: number;
  Lon: number;
  LineCode1: string;
  LineCode2?: string;
  LineCode3?: string;
  LineCode4?: string;
  StationTogether1?: string;
  StationTogether2?: string;
}

// ── Cache ─────────────────────────────────────────────────────────────

let cachedLines: TransitRouteLine[] | null = null;
let fetchInFlight: Promise<TransitRouteLine[]> | null = null;

/**
 * Order WMATA stations into a continuous geographic line.
 *
 * The WMATA API returns stations grouped by branch in center→outward order.
 * To form a single continuous line, we reverse the first branch so the line
 * runs end→center→other_end.
 *
 * Example for Red Line (RD):
 *   API returns: A01, A02, …, A15,  B01, B02, …, B35
 *   Reversed:    A15, A14, …, A01,  B01, B02, …, B35
 *   (Shady Grove → … → Metro Center → Gallery Place → … → Glenmont)
 */
function orderLineStations(stations: WmataStation[]): WmataStation[] {
  if (stations.length < 2) return stations;

  // Group by code prefix (first letter)
  const groups: WmataStation[][] = [];
  let currentPrefix = '';
  let currentGroup: WmataStation[] = [];

  for (const s of stations) {
    const prefix = s.Code.charAt(0);
    if (prefix !== currentPrefix) {
      if (currentGroup.length > 0) groups.push(currentGroup);
      currentGroup = [];
      currentPrefix = prefix;
    }
    currentGroup.push(s);
  }
  if (currentGroup.length > 0) groups.push(currentGroup);

  // Reverse the first group so the line runs end→center→other_end
  const result: WmataStation[] = [];
  for (let i = 0; i < groups.length; i++) {
    if (i === 0) {
      result.push(...groups[i].reverse());
    } else {
      result.push(...groups[i]);
    }
  }
  return result;
}

/**
 * Fetch all WMATA Metrorail route lines with geometry and stops.
 *
 * Strategy:
 *   1. GET /jLines → 6 lines (~0.1s)
 *   2. GET /jStations?LineCode={code} for each line (6 calls, parallel)
 *   3. Build straight-line geometry between stations ordered alphabetically
 *      by station code within shared-station groups (WMATA doesn't expose
 *      track geometry via this API).
 *
 * Total time: ~1s. Cached permanently in memory.
 */
export async function fetchWmataLines(): Promise<TransitRouteLine[]> {
  if (cachedLines) return cachedLines;
  if (fetchInFlight) return fetchInFlight;

  fetchInFlight = (async (): Promise<TransitRouteLine[]> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      // 1. Get all lines
      const linesRes = await fetch(wmataUrl('jLines'), { signal: controller.signal });
      if (!linesRes.ok) return [];
      const linesData: { Lines: WmataLine[] } = await linesRes.json();
      const linesList = linesData.Lines ?? [];

      // 2. Get stations for each line in parallel
      const stationResults = await Promise.all(
        linesList.map(async (line): Promise<WmataStation[] | null> => {
          try {
            const res = await fetch(wmataUrl(`jStations?LineCode=${line.LineCode}`), {
              signal: controller.signal,
            });
            if (!res.ok) return null;
            const data: { Stations: WmataStation[] } = await res.json();
            return data.Stations ?? null;
          } catch {
            return null;
          }
        }),
      );

      // 3. Build route lines
      const result: TransitRouteLine[] = [];

      for (let i = 0; i < linesList.length; i++) {
        const line = linesList[i];
        const stations = stationResults[i];
        if (!stations || stations.length < 2) continue;

        // Deduplicate stations (shared stations appear once per line API response)
        const seen = new Map<string, WmataStation>();
        for (const s of stations) {
          if (!seen.has(s.Code)) seen.set(s.Code, s);
        }
        const unique = [...seen.values()];

        // The API returns stations in branch order (center→outward for each branch).
        // To build a continuous line, reverse the first branch so it runs
        // outward→center→outward.  Branches are identified by code prefix.
        const branchOrdered = orderLineStations(unique);

        // Build geometry from station coordinates in line order
        const geometry: [number, number][] = branchOrdered.map((s) => [s.Lon, s.Lat]);

        // Build stops
        const stops: TransitRouteLineStop[] = unique.map((s) => ({
          name: s.Name,
          lat: s.Lat,
          lon: s.Lon,
          stopId: `wmata:${s.Code}`,
        }));

        const color = WMATA_LINE_COLORS[line.LineCode] || undefined;

        result.push({
          id: `wmata:${line.LineCode}`,
          ref: line.LineCode,
          name: line.DisplayName,
          operator: 'WMATA',
          color,
          mode: 'SUBWAY' as TransitMode,
          geometry: [geometry],
          stops,
        });
      }

      cachedLines = result;
      return result;
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
      fetchInFlight = null;
    }
  })();

  return fetchInFlight;
}

/** Exported for testing. */
export function clearWmataCache(): void {
  cachedLines = null;
  fetchInFlight = null;
}
