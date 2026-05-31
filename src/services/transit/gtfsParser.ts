/**
 * GTFS Parser — shared GTFS ZIP/CSV parsing utilities.
 *
 * Used by both `gtfsStaticFetcher.ts` (MobilityData + dedicated endpoints)
 * and `dotGtfsFetcher.ts` (DOT GTFS registry feeds).
 *
 * No external libraries needed. GTFS zips use STORE or DEFLATE compression
 * handled via DecompressionStream (Web API). CSV parsing is hand-rolled for
 * zero-dependency operation on React Native.
 */

import type { TransitMode, TransitRouteLine, TransitRouteLineStop } from '../../models/transit';
import { inflateRaw } from 'pako';

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
  /** GTFS location_type: 1=station, 0/empty=stop. We filter to stations only. */
  location_type?: number;
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

// ── GtfsFetcherConfig ────────────────────────────────────────────────

export interface GtfsFetcherConfig {
  label: string;
  /** Direct GTFS zip URL. Falls back to MobilityData auto-discovery if omitted. */
  feedUrl?: string;
  /** GTFS route_type values to include (e.g. [1] for subway, [0,1] for light_rail+subway). */
  routeTypeFilter: number[];
  /** Optional override: GTFS route_type → TransitMode. Falls back to built-in map. */
  modeMap?: Record<number, TransitMode>;
  /** Client timeout in ms (default 40_000). */
  timeoutMs?: number;
  /** If false, includes ALL routes regardless of route_type (default true). */
  filterByRouteType?: boolean;
}

// ── GTFS route_type → TransitMode mapping ───────────────────────────

export const DEFAULT_GTFS_MODE_MAP: Record<number, TransitMode> = {
  0: 'TRAM',
  1: 'SUBWAY',
  2: 'RAIL',
  3: 'FERRY',
  4: 'CABLE_CAR',
  5: 'GONDOLA',
  6: 'FUNICULAR',
};

/** All GTFS route_type values for "all modes" configs. */
export const ALL_ROUTE_TYPES = [0, 1, 2, 3, 4, 5, 6, 7];

// ── CSV parser ──────────────────────────────────────────────────────

export function parseCsv(text: string): Record<string, string>[] {
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

export function parseCsvLine(line: string): string[] {
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
export async function extractZipTexts(
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

    // Match by basename (some agencies nest files in subdirs, e.g. google_transit/routes.txt)
    const baseName = fileName.includes('/')
      ? fileName.slice(fileName.lastIndexOf('/') + 1)
      : fileName;
    if (fileNames.includes(baseName)) {
      const rawData = new Uint8Array(buffer, dataOffset, compressedSize);

      if (compressionMethod === 0) {
        // STORE — no compression
        result.set(baseName, decoder.decode(rawData));
      } else if (compressionMethod === 8) {
        // DEFLATE — try DecompressionStream, fall back to pako
        let decompressed: string | null = null;

        // Try browser-native DecompressionStream (available on iOS JSC)
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
          decompressed = decoder.decode(merged);
        } catch {
          // DecompressionStream not available — try pako
        }

        // Fall back to pako (pure-JS inflate, works everywhere)
        if (decompressed === null) {
          try {
            decompressed = decoder.decode(inflateRaw(rawData));
          } catch {
            // Both methods failed — skip this file
          }
        }

        if (decompressed !== null) {
          result.set(baseName, decompressed);
          // Yield to UI thread after each file, especially large ones (CTAs shapes.txt = 28MB)
          await new Promise<void>((r) => setTimeout(r, 0));
        }
      }
    }

    offset = dataOffset + compressedSize;
  }

  return result;
}

// ── Color parsing ───────────────────────────────────────────────────

export function parseGtfsColor(hex?: string): string | undefined {
  if (!hex) return undefined;
  const cleaned = hex.replace('#', '');
  if (/^[0-9A-Fa-f]{6}$/.test(cleaned)) return cleaned;
  return undefined;
}

// ── Mode mapping ────────────────────────────────────────────────────

export function routeTypeToMode(
  routeType: number,
  modeMap?: Record<number, TransitMode>,
): TransitMode {
  return (modeMap ?? DEFAULT_GTFS_MODE_MAP)[routeType] ?? 'BUS';
}

// ── Feed parsing ────────────────────────────────────────────────────

interface ParseGtfsFeedOptions {
  /** If provided, only routes matching these route_type values are kept. */
  routeTypeFilter?: number[];
  /** If provided, limits stop_times/trips to only routes that match. */
  routeIds?: Set<string>;
}

/**
 * Parse raw GTFS text files into a structured GtfsFeedData object.
 *
 * @param files  Map of filename → text content (e.g. from extractZipTexts)
 * @param feedId  Unique identifier for this feed
 * @param provider  Provider/agency label
 * @param options  Optional filtering
 */
export function parseGtfsFeed(
  files: Map<string, string>,
  feedId: string,
  provider: string,
  options?: ParseGtfsFeedOptions,
): GtfsFeedData | null {
  // Parse routes (small, fast)
  const allRoutes: GtfsRoute[] = parseCsv(files.get('routes.txt') ?? '').map((r) => ({
    route_id: r.route_id,
    route_short_name: r.route_short_name,
    route_long_name: r.route_long_name,
    route_type: parseInt(r.route_type, 10) || 3,
    route_color: r.route_color,
    route_text_color: r.route_text_color,
    agency_id: r.agency_id,
  }));

  if (allRoutes.length === 0) return null;

  // Apply route filter
  const filteredRoutes = options?.routeTypeFilter
    ? allRoutes.filter((r) => options.routeTypeFilter!.includes(r.route_type))
    : allRoutes;

  if (filteredRoutes.length === 0) return null;

  const routeIds = options?.routeIds ?? new Set(filteredRoutes.map((r) => r.route_id));

  // Parse stops — keep only stations (location_type=1 in GTFS).
  // This excludes bus stops (location_type=0) and platform-level entries.
  // Agencies that don't use location_type will get no stops — acceptable trade-off
  // since we skip the 100MB+ stop_times.txt for performance.
  const stops: GtfsStop[] = parseCsv(files.get('stops.txt') ?? '')
    .map((s) => ({
      stop_id: s.stop_id,
      stop_name: s.stop_name,
      stop_lat: parseFloat(s.stop_lat),
      stop_lon: parseFloat(s.stop_lon),
      stop_code: s.stop_code,
      parent_station: s.parent_station,
      location_type: s.location_type ? parseInt(s.location_type, 10) || 0 : undefined,
    }))
    .filter((s) => s.location_type === 1);

  // Parse trips — only keep trips for routes we care about
  const allTrips: GtfsTrip[] = parseCsv(files.get('trips.txt') ?? '')
    .filter((t) => routeIds.has(t.route_id))
    .map((t) => ({
      trip_id: t.trip_id,
      route_id: t.route_id,
      service_id: t.service_id,
      trip_headsign: t.trip_headsign,
      direction_id: t.direction_id ? parseInt(t.direction_id, 10) : undefined,
      shape_id: t.shape_id,
    }));

  const tripIds = new Set(allTrips.map((t) => t.trip_id));

  // Parse stop_times — may be omitted for line-only feeds (perf optimization)
  const stopTimesRaw = files.get('stop_times.txt');
  let stopTimes: GtfsStopTime[] = [];
  if (stopTimesRaw) {
    stopTimes = parseCsv(stopTimesRaw)
      .filter((st) => tripIds.has(st.trip_id))
      .map((st) => ({
        trip_id: st.trip_id,
        arrival_time: st.arrival_time,
        departure_time: st.departure_time,
        stop_id: st.stop_id,
        stop_sequence: parseInt(st.stop_sequence, 10),
      }));
  }

  // Parse shapes
  const shapeIds = new Set(allTrips.map((t) => t.shape_id).filter(Boolean));
  const shapePointRows = parseCsv(files.get('shapes.txt') ?? '').filter((sp) =>
    shapeIds.has(sp.shape_id),
  );

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
  for (const t of allTrips) tripIndex.set(t.trip_id, t);

  const stopIndex = new Map<string, GtfsStop>();
  for (const s of stops) stopIndex.set(s.stop_id, s);

  const routeIndex = new Map<string, GtfsRoute>();
  for (const r of allRoutes) routeIndex.set(r.route_id, r);

  const stopTrips = new Map<string, string[]>();
  for (const st of stopTimes) {
    const arr = stopTrips.get(st.stop_id) ?? [];
    arr.push(st.trip_id);
    stopTrips.set(st.stop_id, arr);
  }

  // Agency name
  const agencyRow = parseCsv(files.get('agency.txt') ?? '')[0];

  return {
    feedId,
    provider,
    feedName: agencyRow?.agency_name ?? provider,
    routes: allRoutes,
    stops,
    trips: allTrips,
    stopTimes,
    shapes,
    tripIndex,
    stopIndex,
    routeIndex,
    stopTrips,
  };
}

// ── Feed → TransitRouteLine conversion ──────────────────────────────

/**
 * Convert a parsed GtfsFeedData to TransitRouteLine[] using the given
 * configuration (route_type filter, mode mapping, etc.).
 *
 * Yields to the UI thread every 2 routes to keep the map responsive.
 */
export async function convertFeedToLines(
  feed: GtfsFeedData,
  config: GtfsFetcherConfig,
): Promise<TransitRouteLine[]> {
  const yieldToUI = () => new Promise<void>((r) => setTimeout(r, 0));
  const modeMap = config.modeMap;
  const filterByType = config.filterByRouteType !== false; // default true
  const filteredRoutes = filterByType
    ? feed.routes.filter((r) => new Set(config.routeTypeFilter).has(r.route_type))
    : feed.routes;
  if (filteredRoutes.length === 0) {
    console.warn(
      `[gtfs] convertFeedToLines: no routes after filtering (${feed.feedName}, ${feed.routes.length} total routes)`,
    );
    return [];
  }

  // Build route_id → shape_id via the longest trip
  const routeToShapes = new Map<string, string[]>();
  for (const trip of feed.trips) {
    if (!trip.shape_id) continue;
    if (!filteredRoutes.some((r) => r.route_id === trip.route_id)) continue;
    const arr = routeToShapes.get(trip.route_id) ?? [];
    if (!arr.includes(trip.shape_id)) arr.push(trip.shape_id);
    routeToShapes.set(trip.route_id, arr);
  }

  const lines: TransitRouteLine[] = [];

  for (let i = 0; i < filteredRoutes.length; i++) {
    const route = filteredRoutes[i];
    const shapeIds = routeToShapes.get(route.route_id);
    const geometry: [number, number][] = [];

    if (shapeIds && shapeIds.length > 0) {
      let longest: [number, number][] | null = null;
      for (const sid of shapeIds) {
        const pts = feed.shapes.get(sid);
        if (pts && (!longest || pts.length > longest.length)) {
          longest = pts;
        }
      }
      if (longest) geometry.push(...longest);
    }

    if (geometry.length === 0) {
      // Fallback: build geometry from stop coordinates
      const routeTrips = feed.trips.filter((t) => t.route_id === route.route_id);
      const repTrip = routeTrips[0];
      if (repTrip) {
        const ordered = feed.stopTimes
          .filter((st) => st.trip_id === repTrip.trip_id)
          .sort((a, b) => a.stop_sequence - b.stop_sequence)
          .map((st) => feed.stopIndex.get(st.stop_id))
          .filter((s): s is GtfsStop => !!s);

        for (const s of ordered) {
          geometry.push([s.stop_lon, s.stop_lat]);
        }
      }
    }

    if (geometry.length < 2) continue;

    // Collect stops — when stop_times is available, only include stops on this route's trips.
    // When stop_times is missing (perf optimization), include stops spatially close to the
    // route geometry. This filters out bus stops that are far from the rail line.
    const routeStops: TransitRouteLineStop[] = [];

    if (feed.stopTimes.length > 0) {
      const seen = new Set<string>();
      const routeTripIds = feed.trips
        .filter((t) => t.route_id === route.route_id)
        .map((t) => t.trip_id);
      const routeTripIdSet = new Set(routeTripIds);

      for (const st of feed.stopTimes) {
        if (!routeTripIdSet.has(st.trip_id)) continue;
        const stop = feed.stopIndex.get(st.stop_id);
        if (!stop) continue;
        const key = `${stop.stop_name}:${stop.stop_lat.toFixed(3)},${stop.stop_lon.toFixed(3)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        routeStops.push({
          name: stop.stop_name,
          lat: stop.stop_lat,
          lon: stop.stop_lon,
          stopId: `gtfs:${stop.stop_id}`,
        });
      }
    } else if (geometry.length > 0) {
      // Fallback — no stop_times available. Include stops within ~150m of the route geometry.
      // This filters out bus stops while keeping rail stations that sit on the line.
      const seen = new Set<string>();
      const MAX_DIST_DEG = 0.0015; // ~150m at Chicago latitude

      for (const stop of feed.stopIndex.values()) {
        // Quick bounding-box rejection
        let minDist = Infinity;
        for (const [lon, lat] of geometry) {
          const dLat = stop.stop_lat - lat;
          const dLon = (stop.stop_lon - lon) * Math.cos((lat * Math.PI) / 180);
          const d = dLat * dLat + dLon * dLon;
          if (d < minDist) minDist = d;
          if (minDist < MAX_DIST_DEG * MAX_DIST_DEG) break; // early exit
        }
        if (minDist > MAX_DIST_DEG * MAX_DIST_DEG) continue;

        const key = `${stop.stop_name}:${stop.stop_lat.toFixed(3)},${stop.stop_lon.toFixed(3)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        routeStops.push({
          name: stop.stop_name,
          lat: stop.stop_lat,
          lon: stop.stop_lon,
          stopId: `gtfs:${stop.stop_id}`,
        });
      }
    }

    lines.push({
      id: `gtfs:${feed.feedId}:${route.route_id}`,
      ref: route.route_short_name,
      name: route.route_long_name ?? route.route_short_name,
      operator: feed.feedName,
      color: parseGtfsColor(route.route_color),
      mode: routeTypeToMode(route.route_type, modeMap),
      geometry: [geometry],
      stops: routeStops,
    });

    // Yield every 2 routes to keep UI responsive
    if ((i + 1) % 2 === 0 && i < filteredRoutes.length - 1) {
      await yieldToUI();
    }
  }

  return lines;
}
