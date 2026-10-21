/**
 * Transport for London (TfL) Unified API fetcher.
 *
 * Provides route lines + stops for the London transit network:
 * Tube, DLR, Overground, Elizabeth line, and Trams.
 *
 * API: https://api.tfl.gov.uk
 * No API key required for the Unified API.
 */

import type { TransitMode, TransitRouteLine, TransitRouteLineStop } from '../../models/transit';

const TFL_BASE = 'https://api.tfl.gov.uk';
const FETCH_TIMEOUT_MS = 30_000;

const TFL_MODE_MAP: Record<string, TransitMode> = {
  tube: 'SUBWAY',
  dlr: 'TRAM',
  tram: 'TRAM',
  overground: 'RAIL',
  'elizabeth-line': 'RAIL',
};

function tflModeToTransitMode(modeName: string): TransitMode {
  return TFL_MODE_MAP[modeName] ?? 'RAIL';
}

const RAIL_MODES = ['tube', 'dlr', 'overground', 'elizabeth-line', 'tram'];

/** `[lon, lat]` pair as returned by TfL (GeoJSON order). */
function isLngLat(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  );
}

function toSegment(points: unknown): [number, number][] {
  if (!Array.isArray(points)) return [];
  return points.filter(isLngLat).map(([lon, lat]) => [lon, lat] as [number, number]);
}

/**
 * Parse one TfL `lineStrings` entry.
 *
 * TfL serialises these as a JSON string whose shape is either
 * `[[lon, lat], ...]` (a single polyline) or `[[[lon, lat], ...], ...]`
 * (one polyline per branch).  Both are normalised to a list of segments
 * so branches never get joined by a spurious straight line.
 *
 * Exported for testing.
 */
export function parseTflLineString(raw: string): [number, number][][] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return [];
  if (isLngLat(parsed[0])) {
    const segment = toSegment(parsed);
    return segment.length >= 2 ? [segment] : [];
  }
  return parsed
    .map(toSegment)
    .filter((segment): segment is [number, number][] => segment.length >= 2);
}

let cachedLines: TransitRouteLine[] | null = null;
let fetchInFlight: Promise<TransitRouteLine[]> | null = null;

interface TflLine {
  id: string;
  name: string;
  modeName: string;
  lineStatuses: Array<{ statusSeverity: number }>;
}

interface TflStopPoint {
  id: string;
  commonName: string;
  lat: number;
  lon: number;
}

async function fetchOneTflLine(
  line: TflLine,
  signal: AbortSignal,
): Promise<TransitRouteLine | null> {
  const [routeRes, stopsRes] = await Promise.all([
    fetch(`${TFL_BASE}/Line/${encodeURIComponent(line.id)}/Route/Sequence/outbound`, { signal }),
    fetch(`${TFL_BASE}/Line/${encodeURIComponent(line.id)}/StopPoints`, { signal }),
  ]);

  let geometry: [number, number][][] = [];
  if (routeRes.ok) {
    const routeData = (await routeRes.json()) as {
      lineStrings?: string[];
      stations?: Array<{ lat: number; lon: number }>;
    };
    if (routeData.lineStrings && routeData.lineStrings.length > 0) {
      // Each entry is a JSON string describing one or more branch
      // polylines.  Keep them as separate segments — concatenating them
      // would draw a straight line between the end of one branch and the
      // start of the next.
      for (const ls of routeData.lineStrings) {
        geometry.push(...parseTflLineString(ls));
      }
    } else if (routeData.stations && routeData.stations.length >= 2) {
      geometry = [routeData.stations.map((s) => [s.lon, s.lat] as [number, number])];
    }
  }

  if (geometry.length === 0) return null;

  const stops: TransitRouteLineStop[] = [];
  if (stopsRes.ok) {
    const stopsData = (await stopsRes.json()) as TflStopPoint[];
    const seen = new Set<string>();
    for (const sp of stopsData) {
      if (!sp.commonName) continue;
      const key = `${sp.commonName}:${sp.lat.toFixed(3)},${sp.lon.toFixed(3)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      stops.push({ name: sp.commonName, lat: sp.lat, lon: sp.lon, stopId: `tfl:${sp.id}` });
    }
  }

  return {
    id: `tfl:${line.id}`,
    ref: line.id,
    name: line.name,
    operator: 'TfL',
    color: undefined,
    mode: tflModeToTransitMode(line.modeName),
    geometry,
    stops,
  };
}

export async function fetchTflLines(): Promise<TransitRouteLine[]> {
  if (cachedLines) return cachedLines;
  if (fetchInFlight) return fetchInFlight;

  fetchInFlight = doFetchTflLines().then(
    (result) => result,
    () => [],
  );
  return fetchInFlight;
}

async function doFetchTflLines(): Promise<TransitRouteLine[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS * 2);

  try {
    const modeResults = await Promise.all(
      RAIL_MODES.map(async (mode) => {
        const innerRes = await fetch(`${TFL_BASE}/Line/Mode/${mode}`, {
          signal: controller.signal,
        });
        if (!innerRes.ok) return [] as TflLine[];
        const data: TflLine[] = await innerRes.json();
        return data.filter((l) => {
          const sev = l.lineStatuses?.[0]?.statusSeverity ?? 10;
          return sev <= 10;
        });
      }),
    );

    const allLines = new Map<string, TflLine>();
    for (const lines of modeResults) {
      for (const l of lines) {
        if (!allLines.has(l.id)) allLines.set(l.id, l);
      }
    }

    const lineList = [...allLines.values()];
    if (lineList.length === 0) {
      cachedLines = [];
      return [];
    }

    const result: TransitRouteLine[] = [];
    const batches: TflLine[][] = [];
    for (let i = 0; i < lineList.length; i += 4) {
      batches.push(lineList.slice(i, i + 4));
    }

    for (const batch of batches) {
      const batchResults = await Promise.all(
        batch.map((line) => fetchOneTflLine(line, controller.signal).catch(() => null)),
      );

      for (const line of batchResults) {
        if (line) result.push(line);
      }
    }

    cachedLines = result;
    return result;
  } catch {
    cachedLines = [];
    return [];
  } finally {
    clearTimeout(timer);
    fetchInFlight = null;
  }
}

/** Exported for testing. */
export function clearTflCache(): void {
  cachedLines = null;
  fetchInFlight = null;
}
