/**
 * GTFS Static Feed Fetcher
 *
 * Downloads official GTFS feeds via MobilityData catalog, unzips, and
 * parses the CSV files into typed structures for routes, stops, shapes,
 * trips, and stop_times.
 *
 * Only rail-related feeds are parsed (route_type 1=subway, 2=rail).
 * Feed discovery is cached for 24 hours; parsed data is cached in memory.
 */

import { discoverFeeds } from './transitFeedService';
import type { TransitFeed } from '../../models/transit';
import { TRANSIT_FEED_CACHE_TTL_MS } from '../../constants/config';

// ── GTFS parsed types ───────────────────────────────────────────────

export interface GtfsRoute {
  route_id: string;
  route_short_name?: string;
  route_long_name?: string;
  route_type: number;
  route_color?: string;
  route_text_color?: string;
  agency_id?: string;
}

export interface GtfsStop {
  stop_id: string;
  stop_name: string;
  stop_lat: number;
  stop_lon: number;
  stop_code?: string;
  parent_station?: string;
}

export interface GtfsTrip {
  trip_id: string;
  route_id: string;
  service_id: string;
  trip_headsign?: string;
  direction_id?: number;
  shape_id?: string;
}

export interface GtfsStopTime {
  trip_id: string;
  arrival_time: string;
  departure_time: string;
  stop_id: string;
  stop_sequence: number;
}

export interface GtfsShapePoint {
  shape_id: string;
  shape_pt_lat: number;
  shape_pt_lon: number;
  shape_pt_sequence: number;
}

export interface GtfsFeedData {
  feedId: string;
  provider: string;
  feedName: string;
  routes: GtfsRoute[];
  stops: GtfsStop[];
  trips: GtfsTrip[];
  stopTimes: GtfsStopTime[];
  /** shape_id → ordered [lng, lat][] */
  shapes: Map<string, [number, number][]>;
  /** trip_id → GtfsTrip */
  tripIndex: Map<string, GtfsTrip>;
  /** stop_id → GtfsStop */
  stopIndex: Map<string, GtfsStop>;
  /** route_id → GtfsRoute */
  routeIndex: Map<string, GtfsRoute>;
  /** stop_id → trip_ids stopping there */
  stopTrips: Map<string, string[]>;
}

// ── CSV parser ──────────────────────────────────────────────────────

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split('\n').filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]);
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    if (values.length < headers.length) continue;
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j];
    }
    rows.push(row);
  }

  return rows;
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  values.push(current.trim());
  return values;
}

// ── Zip extraction (minimal, for GTFS) ──────────────────────────────

/**
 * Extract text files from a ZIP ArrayBuffer using the ZIP local file
 * header format. No external library needed — GTFS zips use STORE or
 * DEFLATE compression which we handle via DecompressionStream (Web API).
 */
async function extractZipTexts(
  buffer: ArrayBuffer,
  fileNames: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const view = new DataView(buffer);
  const decoder = new TextDecoder();
  let offset = 0;

  while (offset < buffer.byteLength - 4) {
    const sig = view.getUint32(offset, true);
    if (sig !== 0x04034b50) break; // Not a local file header

    const compressionMethod = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);
    const fileName = decoder.decode(new Uint8Array(buffer, offset + 30, nameLen));
    const dataOffset = offset + 30 + nameLen + extraLen;

    if (fileNames.includes(fileName)) {
      const rawData = new Uint8Array(buffer, dataOffset, compressedSize);

      if (compressionMethod === 0) {
        // STORE — no compression
        result.set(fileName, decoder.decode(rawData));
      } else if (compressionMethod === 8) {
        // DEFLATE — use DecompressionStream
        try {
          const ds = new DecompressionStream('deflate-raw' as CompressionFormat);
          const writer = ds.writable.getWriter();
          writer.write(rawData);
          writer.close();
          const reader = ds.readable.getReader();
          const chunks: Uint8Array[] = [];
          let done = false;
          while (!done) {
            const { value, done: d } = await reader.read();
            if (value) chunks.push(value);
            done = d;
          }
          const total = chunks.reduce((s, c) => s + c.length, 0);
          const merged = new Uint8Array(total);
          let pos = 0;
          for (const c of chunks) {
            merged.set(c, pos);
            pos += c.length;
          }
          result.set(fileName, decoder.decode(merged));
        } catch {
          // DecompressionStream not available — skip this file
        }
      }
    }

    offset = dataOffset + compressedSize;
  }

  return result;
}

// ── Feed data cache ─────────────────────────────────────────────────

interface FeedCacheEntry {
  data: GtfsFeedData;
  fetchedAt: number;
}

const feedDataCache = new Map<string, FeedCacheEntry>();
const FEED_DATA_CACHE_TTL = TRANSIT_FEED_CACHE_TTL_MS;

// ── Rail route types (GTFS route_type) ──────────────────────────────

/** GTFS route_type values we consider "rail": 1=subway, 2=rail */
const RAIL_ROUTE_TYPES = new Set([1, 2]);

// ── Public API ──────────────────────────────────────────────────────

/**
 * Discover and download GTFS static feeds for a bounding box.
 * Returns parsed feed data for all rail-related feeds in the area.
 * Results are cached in memory.
 */
export async function fetchGtfsFeeds(
  minLat: number,
  minLng: number,
  maxLat: number,
  maxLng: number,
): Promise<GtfsFeedData[]> {
  let feeds: TransitFeed[];
  try {
    feeds = await discoverFeeds(minLat, minLng, maxLat, maxLng);
  } catch {
    return [];
  }

  // Filter to feeds that have a download URL and are likely rail-related
  const railFeeds = feeds.filter((f) => {
    if (!f.latest_dataset?.hosted_url) return false;
    const name = (f.feed_name ?? f.provider ?? '').toLowerCase();
    // Include feeds with rail-related names, skip obvious bus-only
    return (
      name.includes('rail') ||
      name.includes('subway') ||
      name.includes('metro') ||
      name.includes('tram') ||
      name.includes('light rail') ||
      name.includes('transit') ||
      name.includes('path') ||
      // Include feeds without clear bus-only names (they may be
      // multi-modal), we'll filter by route_type after parsing
      (!name.includes('bus') && !name.includes('ferry'))
    );
  });

  // Download and parse each feed (in parallel, from cache if available)
  const results = await Promise.all(railFeeds.slice(0, 8).map((f) => fetchAndParseFeed(f)));

  // Only return feeds that actually contain rail routes
  return results.filter(
    (d): d is GtfsFeedData =>
      d !== null && d.routes.some((r) => RAIL_ROUTE_TYPES.has(r.route_type)),
  );
}

async function fetchAndParseFeed(feed: TransitFeed): Promise<GtfsFeedData | null> {
  const url = feed.latest_dataset?.hosted_url;
  if (!url) return null;

  // Check cache
  const cached = feedDataCache.get(feed.id);
  if (cached && Date.now() - cached.fetchedAt < FEED_DATA_CACHE_TTL) {
    return cached.data;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;

    const buffer = await res.arrayBuffer();

    const needed = [
      'agency.txt',
      'routes.txt',
      'stops.txt',
      'trips.txt',
      'stop_times.txt',
      'shapes.txt',
    ];
    const files = await extractZipTexts(buffer, needed);

    // Parse routes — only keep rail types
    const allRoutes = parseCsv(files.get('routes.txt') ?? '').map(
      (r): GtfsRoute => ({
        route_id: r.route_id,
        route_short_name: r.route_short_name,
        route_long_name: r.route_long_name,
        route_type: parseInt(r.route_type, 10),
        route_color: r.route_color,
        route_text_color: r.route_text_color,
        agency_id: r.agency_id,
      }),
    );
    const routes = allRoutes.filter((r) => RAIL_ROUTE_TYPES.has(r.route_type));
    if (routes.length === 0) return null;

    const railRouteIds = new Set(routes.map((r) => r.route_id));

    // Parse stops
    const stops = parseCsv(files.get('stops.txt') ?? '').map(
      (s): GtfsStop => ({
        stop_id: s.stop_id,
        stop_name: s.stop_name,
        stop_lat: parseFloat(s.stop_lat),
        stop_lon: parseFloat(s.stop_lon),
        stop_code: s.stop_code,
        parent_station: s.parent_station,
      }),
    );

    // Parse trips — only for rail routes
    const allTrips = parseCsv(files.get('trips.txt') ?? '').map(
      (t): GtfsTrip => ({
        trip_id: t.trip_id,
        route_id: t.route_id,
        service_id: t.service_id,
        trip_headsign: t.trip_headsign,
        direction_id: t.direction_id ? parseInt(t.direction_id, 10) : undefined,
        shape_id: t.shape_id,
      }),
    );
    const trips = allTrips.filter((t) => railRouteIds.has(t.route_id));
    const tripIds = new Set(trips.map((t) => t.trip_id));

    // Parse stop_times — only for rail trips
    const stopTimes = parseCsv(files.get('stop_times.txt') ?? '')
      .filter((st) => tripIds.has(st.trip_id))
      .map(
        (st): GtfsStopTime => ({
          trip_id: st.trip_id,
          arrival_time: st.arrival_time,
          departure_time: st.departure_time,
          stop_id: st.stop_id,
          stop_sequence: parseInt(st.stop_sequence, 10),
        }),
      );

    // Parse shapes — only for rail trip shapes
    const railShapeIds = new Set(trips.map((t) => t.shape_id).filter(Boolean));
    const shapePointRows = parseCsv(files.get('shapes.txt') ?? '').filter((sp) =>
      railShapeIds.has(sp.shape_id),
    );

    // Group shape points by shape_id, sort by sequence
    const shapesRaw = new Map<string, { lat: number; lon: number; seq: number }[]>();
    for (const sp of shapePointRows) {
      const arr = shapesRaw.get(sp.shape_id) ?? [];
      arr.push({
        lat: parseFloat(sp.shape_pt_lat),
        lon: parseFloat(sp.shape_pt_lon),
        seq: parseInt(sp.shape_pt_sequence, 10),
      });
      shapesRaw.set(sp.shape_id, arr);
    }

    const shapes = new Map<string, [number, number][]>();
    for (const [id, pts] of shapesRaw) {
      pts.sort((a, b) => a.seq - b.seq);
      shapes.set(
        id,
        pts.map((p) => [p.lon, p.lat]),
      );
    }

    // Build indexes
    const tripIndex = new Map<string, GtfsTrip>();
    for (const t of trips) tripIndex.set(t.trip_id, t);

    const stopIndex = new Map<string, GtfsStop>();
    for (const s of stops) stopIndex.set(s.stop_id, s);

    const routeIndex = new Map<string, GtfsRoute>();
    for (const r of routes) routeIndex.set(r.route_id, r);

    // Build stop→trip mapping
    const stopTrips = new Map<string, string[]>();
    for (const st of stopTimes) {
      const arr = stopTrips.get(st.stop_id) ?? [];
      arr.push(st.trip_id);
      stopTrips.set(st.stop_id, arr);
    }

    const agencyRow = parseCsv(files.get('agency.txt') ?? '')[0];

    const data: GtfsFeedData = {
      feedId: feed.id,
      provider: feed.provider,
      feedName: feed.feed_name ?? agencyRow?.agency_name ?? feed.provider,
      routes,
      stops,
      trips,
      stopTimes,
      shapes,
      tripIndex,
      stopIndex,
      routeIndex,
      stopTrips,
    };

    // Cache it
    feedDataCache.set(feed.id, { data, fetchedAt: Date.now() });
    if (feedDataCache.size > 20) {
      const oldest = [...feedDataCache.entries()].sort((a, b) => a[1].fetchedAt - b[1].fetchedAt);
      feedDataCache.delete(oldest[0][0]);
    }

    return data;
  } catch {
    return null;
  }
}

/**
 * Clear all cached GTFS data. Useful when changing regions.
 */
export function clearGtfsCache(): void {
  feedDataCache.clear();
}
