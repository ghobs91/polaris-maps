/**
 * BART (Bay Area Rapid Transit) API fetcher.
 *
 * Provides route lines + stops for the SF Bay Area rapid transit system
 * (Red, Orange, Yellow, Green, Blue lines).  BART has an aging but public
 * REST/XML API that includes station coordinates.
 *
 * API: https://api.bart.gov
 * No API key required.
 */

import type { TransitMode, TransitRouteLine, TransitRouteLineStop } from '../../models/transit';

const BART_BASE = 'https://api.bart.gov/api';
const FETCH_TIMEOUT_MS = 20_000;

// ── BART route colour → hex (official colours) ───────────────────────

const BART_LINE_COLORS: Record<string, string> = {
  '1': 'FFE800', // Yellow
  '2': 'FF0000', // Red
  '3': 'FF0000', // Richmond (Red)
  '4': '0000FF', // Blue
  '5': 'FFA500', // Orange
  '6': '33CC33', // Green
  '7': 'FF1434', // OAK (used to be Coliseum-OAK)
  '8': 'FF1434', // OAK connector
  '11': '0000FF', // Dublin/Pleasanton (Blue extension)
  '12': 'FF0000', // Richmond (Red extension)
  '19': '33CC33', // Green (Berryessa)
};

interface BartRoute {
  name: string;
  abbr: string;
  number: string;
  color: string;
  hexcolor: string;
}

interface BartRouteInfoStation {
  name: string;
  abbr: string;
  gtfs_latitude: string;
  gtfs_longitude: string;
}

interface BartRouteInfo {
  name: string;
  abbr: string;
  number: string;
  color: string;
  hexcolor: string;
  config: {
    station: BartRouteInfoStation | BartRouteInfoStation[];
  };
}

// ── Cache ─────────────────────────────────────────────────────────────

let cachedLines: TransitRouteLine[] | null = null;
let fetchInFlight: Promise<TransitRouteLine[]> | null = null;

async function bartXmlFetch(path: string): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${BART_BASE}/${path}`, {
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const xml = await res.text();
    // BART returns XML — parse manually as we only need a few fields
    return xml;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Minimal XML tag extractor. Given `<tag>value</tag>`, returns value.
 * Handles the simple BART XML response structure.
 */
function xmlTags(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}>(.*?)</${tag}>`, 'gs');
  const matches: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    matches.push(m[1]);
  }
  return matches;
}

function xmlTag(xml: string, tag: string): string | undefined {
  return xmlTags(xml, tag)[0];
}

/**
 * Fetch all BART route lines with geometry and stops.
 *
 * Strategy:
 *   1. GET /route.aspx?cmd=routes — list of routes
 *   2. GET /route.aspx?cmd=routeinfo&route={number} for each route
 *   3. Build straight-line geometry between stations in config order
 */
export async function fetchBartLines(): Promise<TransitRouteLine[]> {
  if (cachedLines) return cachedLines;
  if (fetchInFlight) return fetchInFlight;

  fetchInFlight = (async (): Promise<TransitRouteLine[]> => {
    try {
      // 1. Get routes list
      const routesXml = await bartXmlFetch('route.aspx?cmd=routes');
      if (!routesXml) return [];

      const routeElements = routesXml.split('<route>').slice(1);
      const routes: BartRoute[] = [];

      for (const el of routeElements) {
        const name = xmlTag(el, 'name');
        const abbr = xmlTag(el, 'abbr');
        const number = xmlTag(el, 'number');
        const color = xmlTag(el, 'color');
        const hexcolor = xmlTag(el, 'hexcolor');
        if (name && number) {
          routes.push({ name, abbr: abbr ?? '', number, color: color ?? '', hexcolor: hexcolor ?? '' });
        }
      }

      // 2. Get detailed route info for each visible route (concurrent, limit 4)
      // Skip combined/unusual route numbers
      const mainRoutes = routes.filter(
        (r) =>
          r.name &&
          !r.name.includes('Combined') &&
          !r.name.includes('Special'),
      );

      const lines: TransitRouteLine[] = [];
      const batches: (typeof mainRoutes)[] = [];
      for (let i = 0; i < mainRoutes.length; i += 4) {
        batches.push(mainRoutes.slice(i, i + 4));
      }

      for (const batch of batches) {
        const results = await Promise.all(
          batch.map(async (route): Promise<TransitRouteLine | null> => {
            try {
              const infoXml = await bartXmlFetch(
                `route.aspx?cmd=routeinfo&route=${route.number}`,
              );
              if (!infoXml) return null;

              // Parse stations
              const stationElements = infoXml.split('<station>').slice(1);
              const stations: BartRouteInfoStation[] = [];
              for (const el of stationElements) {
                const sName = xmlTag(el, 'name');
                const sLat = xmlTag(el, 'gtfs_latitude');
                const sLon = xmlTag(el, 'gtfs_longitude');
                if (sName && sLat && sLon) {
                  stations.push({
                    name: sName,
                    abbr: xmlTag(el, 'abbr') ?? '',
                    gtfs_latitude: sLat,
                    gtfs_longitude: sLon,
                  });
                }
              }

              if (stations.length < 2) return null;

              // Build geometry from station coordinates
              const geometry: [number, number][] = stations.map((s) => [
                parseFloat(s.gtfs_longitude),
                parseFloat(s.gtfs_latitude),
              ]);

              // Build stops
              const stops: TransitRouteLineStop[] = stations.map((s) => ({
                name: s.name,
                lat: parseFloat(s.gtfs_latitude),
                lon: parseFloat(s.gtfs_longitude),
                stopId: `bart:${s.abbr}`,
              }));

              let color = BART_LINE_COLORS[route.number];
              if (!color && route.hexcolor) {
                color = route.hexcolor.replace('#', '');
              }

              return {
                id: `bart:${route.number}`,
                ref: route.abbr || route.number,
                name: route.name,
                operator: 'BART',
                color,
                mode: 'SUBWAY' as TransitMode,
                geometry: [geometry],
                stops,
              };
            } catch {
              return null;
            }
          }),
        );

        for (const line of results) {
          if (line) lines.push(line);
        }
      }

      cachedLines = lines;
      return lines;
    } catch {
      return [];
    } finally {
      fetchInFlight = null;
    }
  })();

  return fetchInFlight;
}

/** Exported for testing. */
export function clearBartCache(): void {
  cachedLines = null;
  fetchInFlight = null;
}
