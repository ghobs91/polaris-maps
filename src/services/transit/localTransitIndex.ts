/**
 * On-device OSM transit index (Tier 0 for the transit side).
 *
 * Two Overpass queries dominate the transit UI:
 *
 * - viewport route relations (`relation["route"~"^(subway|light_rail|train|tram|monorail)$"]`)
 * - "which lines stop at this stop?" (`rel(bn.stops)["route"~...]`)
 *
 * Both are precomputable: route relations change on the timescale of a GTFS
 * feed refresh, not of a map pan. A region pack ships `transit.sqlite` with
 * stops, route relations (geometry already resolved) and the stop↔route join,
 * which is exactly what Overpass assembles at request time.
 *
 * The app answers from these tables when the area is covered and falls back to
 * Overpass/OTP/GTFS otherwise.
 */

import * as SQLite from 'expo-sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { getDatabase } from '../database/init';
import { logDiagnostic } from '../diagnostics/diagnosticsLog';

export const LOCAL_TRANSIT_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS osm_transit_stops (
    osm_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    tags_json TEXT NOT NULL,
    region_id TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_osm_transit_stops_bounds ON osm_transit_stops (lat, lng);

  CREATE TABLE IF NOT EXISTS osm_transit_routes (
    osm_id INTEGER PRIMARY KEY,
    mode TEXT NOT NULL,
    ref TEXT,
    name TEXT,
    colour TEXT,
    geometry_json TEXT NOT NULL,
    stop_ids_json TEXT NOT NULL DEFAULT '[]',
    south REAL NOT NULL,
    west REAL NOT NULL,
    north REAL NOT NULL,
    east REAL NOT NULL,
    region_id TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_osm_transit_routes_bounds
    ON osm_transit_routes (south, north, west, east);
  CREATE INDEX IF NOT EXISTS idx_osm_transit_routes_ref ON osm_transit_routes (ref);

  CREATE TABLE IF NOT EXISTS osm_transit_route_stops (
    stop_osm_id INTEGER NOT NULL,
    route_osm_id INTEGER NOT NULL,
    PRIMARY KEY (stop_osm_id, route_osm_id)
  );
  CREATE INDEX IF NOT EXISTS idx_osm_transit_route_stops_stop
    ON osm_transit_route_stops (stop_osm_id);

  CREATE TABLE IF NOT EXISTS local_transit_coverage (
    region_id TEXT PRIMARY KEY,
    south REAL NOT NULL,
    west REAL NOT NULL,
    north REAL NOT NULL,
    east REAL NOT NULL,
    stop_count INTEGER NOT NULL DEFAULT 0,
    route_count INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  );
`;

export interface TransitBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** Subset of OSM route modes the transit UI renders. */
export const LOCAL_TRANSIT_MODES = ['subway', 'light_rail', 'train', 'tram', 'monorail'] as const;

/** App-level transit modes used by the map layer. */
export type LocalTransitMode = 'SUBWAY' | 'TRAM' | 'RAIL';

export interface LocalTransitStop {
  osmId: number;
  name: string;
  lat: number;
  lng: number;
  tags: Record<string, string>;
}

/** One rendered line, in the shape the map layer consumes. */
export interface LocalTransitRoute {
  osmId: number;
  mode: string;
  ref?: string;
  name?: string;
  colour?: string;
  /** `[[lat, lng], ...]` */
  geometry: Array<[number, number]>;
  stopIds: number[];
}

/** A line serving a stop, matching `fetchRoutesAtStop`'s return shape. */
export interface LocalRouteTag {
  ref?: string;
  name?: string;
  colour?: string;
  mode: LocalTransitMode;
}

const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance in metres. */
export function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Lat/lng box that contains every point within `radiusMeters` of the centre. */
export function bboxForRadius(
  lat: number,
  lng: number,
  radiusMeters: number,
): { south: number; west: number; north: number; east: number } {
  const dLat = (radiusMeters / EARTH_RADIUS_M) * (180 / Math.PI);
  const cosLat = Math.max(Math.cos((lat * Math.PI) / 180), 1e-6);
  const dLng = dLat / cosLat;
  return { south: lat - dLat, north: lat + dLat, west: lng - dLng, east: lng + dLng };
}

/** Map an OSM `route` tag value to the app's `TransitMode`. */
export function transitModeFor(routeTag: string | undefined): LocalTransitMode {
  if (routeTag === 'subway') return 'SUBWAY';
  if (routeTag === 'light_rail' || routeTag === 'tram') return 'TRAM';
  return 'RAIL';
}

/** Accept either an OSM route value or an already-normalised app mode. */
function coerceStoredMode(value: string | null | undefined): LocalTransitMode {
  const raw = (value ?? '').trim();
  if (raw === 'SUBWAY' || raw === 'TRAM' || raw === 'RAIL') return raw;
  return transitModeFor(raw.toLowerCase());
}

let _schemaReady: Promise<void> | null = null;

export function ensureLocalTransitSchema(database?: SQLiteDatabase): Promise<void> {
  if (database) return database.execAsync(LOCAL_TRANSIT_SCHEMA_SQL);
  if (!_schemaReady) {
    _schemaReady = getDatabase()
      .then((db) => db.execAsync(LOCAL_TRANSIT_SCHEMA_SQL))
      .catch((err) => {
        _schemaReady = null;
        throw err;
      });
  }
  return _schemaReady;
}

/** Exposed for testing only. */
export function __resetLocalTransitSchemaCacheForTests(): void {
  _schemaReady = null;
}

interface StopRow {
  osm_id: number;
  name: string;
  lat: number;
  lng: number;
  tags_json: string;
}

function parseTags(json: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** Stops within `radiusMeters` of a point, nearest first. */
export async function queryTransitStopsNear(
  lat: number,
  lng: number,
  radiusMeters: number,
  limit = 20,
): Promise<LocalTransitStop[]> {
  await ensureLocalTransitSchema();
  const db = await getDatabase();
  const box = bboxForRadius(lat, lng, radiusMeters);
  const rows = await db.getAllAsync<StopRow>(
    `SELECT osm_id, name, lat, lng, tags_json
       FROM osm_transit_stops
      WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?
      LIMIT ?`,
    [box.south, box.north, box.west, box.east, Math.max(limit * 4, 40)],
  );

  return rows
    .map((row) => ({
      osmId: row.osm_id,
      name: row.name,
      lat: row.lat,
      lng: row.lng,
      tags: parseTags(row.tags_json),
      distance: haversineMeters(lat, lng, row.lat, row.lng),
    }))
    .filter((stop) => stop.distance <= radiusMeters)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
    .map(({ distance: _distance, ...stop }) => stop);
}

interface RouteStopRow {
  ref: string | null;
  name: string | null;
  colour: string | null;
  route_mode: string;
}

/** Distinct lines serving any of the given stops, deduplicated by identity. */
export async function queryRouteTagsAtStops(stopIds: readonly number[]): Promise<LocalRouteTag[]> {
  if (stopIds.length === 0) return [];
  await ensureLocalTransitSchema();
  const db = await getDatabase();
  const placeholders = stopIds.map(() => '?').join(', ');
  const rows = await db.getAllAsync<RouteStopRow>(
    `SELECT r.ref AS ref, r.name AS name, r.colour AS colour, r.mode AS route_mode
       FROM osm_transit_route_stops rs
       JOIN osm_transit_routes r ON r.osm_id = rs.route_osm_id
      WHERE rs.stop_osm_id IN (${placeholders})
      ORDER BY r.mode, r.ref`,
    [...stopIds],
  );

  const seen = new Set<string>();
  const out: LocalRouteTag[] = [];
  for (const row of rows) {
    const identity = `${row.route_mode}|${row.ref ?? ''}|${row.name ?? ''}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    out.push({
      ref: row.ref ?? undefined,
      name: row.name ?? undefined,
      colour: row.colour ?? undefined,
      mode: coerceStoredMode(row.route_mode),
    });
  }
  return out;
}

/**
 * Lines serving a stop, resolved entirely on device.
 *
 * Returns `null` when no imported region covers the point, so the caller can
 * tell "no lines here" from "we have no data here" and fall back to Overpass.
 */
export async function localRoutesAtPoint(
  lat: number,
  lng: number,
  radiusMeters = 100,
): Promise<LocalRouteTag[] | null> {
  if (!(await hasLocalTransitCoverage({ south: lat, west: lng, north: lat, east: lng }))) {
    return null;
  }
  const stops = await queryTransitStopsNear(lat, lng, radiusMeters, 10);
  if (stops.length === 0) return [];
  return queryRouteTagsAtStops(stops.map((s) => s.osmId));
}

interface RouteRow {
  osm_id: number;
  mode: string;
  ref: string | null;
  name: string | null;
  colour: string | null;
  geometry_json: string;
  stop_ids_json: string;
}

/** Route relations whose bounding box intersects the viewport. */
export async function queryTransitRoutesInBounds(
  bounds: TransitBounds,
  limit = 500,
): Promise<LocalTransitRoute[]> {
  await ensureLocalTransitSchema();
  const db = await getDatabase();
  const rows = await db.getAllAsync<RouteRow>(
    `SELECT osm_id, mode, ref, name, colour, geometry_json, stop_ids_json
       FROM osm_transit_routes
      WHERE south <= ? AND north >= ? AND west <= ? AND east >= ?
      LIMIT ?`,
    [bounds.north, bounds.south, bounds.east, bounds.west, Math.max(1, limit)],
  );

  return rows.map((row) => {
    let geometry: Array<[number, number]> = [];
    try {
      const parsed: unknown = JSON.parse(row.geometry_json);
      if (Array.isArray(parsed)) geometry = parsed as Array<[number, number]>;
    } catch {
      // Truncated geometry: keep the route, render without a line.
    }
    let stopIds: number[] = [];
    try {
      const parsed: unknown = JSON.parse(row.stop_ids_json);
      if (Array.isArray(parsed)) stopIds = parsed as number[];
    } catch {
      // Same as above.
    }
    return {
      osmId: row.osm_id,
      mode: row.mode,
      ref: row.ref ?? undefined,
      name: row.name ?? undefined,
      colour: row.colour ?? undefined,
      geometry,
      stopIds,
    };
  });
}

/** True when an imported region covers the box. */
export async function hasLocalTransitCoverage(bounds: TransitBounds): Promise<boolean> {
  await ensureLocalTransitSchema();
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ covered: number }>(
    `SELECT COUNT(*) AS covered
       FROM local_transit_coverage
      WHERE south <= ? AND north >= ? AND west <= ? AND east >= ?`,
    [bounds.south, bounds.north, bounds.west, bounds.east],
  );
  return (row?.covered ?? 0) > 0;
}

/** Replace one region's transit rows (pack import / refresh). */
export async function replaceRegionTransitIndex(
  regionId: string,
  bounds: TransitBounds,
  data: {
    stops: ReadonlyArray<LocalTransitStop>;
    routes: ReadonlyArray<LocalTransitRoute>;
  },
): Promise<void> {
  await ensureLocalTransitSchema();
  const db = await getDatabase();
  const now = Date.now();

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      'DELETE FROM osm_transit_route_stops WHERE stop_osm_id IN (SELECT osm_id FROM osm_transit_stops WHERE region_id = ?)',
      [regionId],
    );
    await db.runAsync('DELETE FROM osm_transit_stops WHERE region_id = ?', [regionId]);
    await db.runAsync('DELETE FROM osm_transit_routes WHERE region_id = ?', [regionId]);

    for (const stop of data.stops) {
      await db.runAsync(
        `INSERT INTO osm_transit_stops (osm_id, name, lat, lng, tags_json, region_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (osm_id) DO UPDATE SET
           name = excluded.name,
           lat = excluded.lat,
           lng = excluded.lng,
           tags_json = excluded.tags_json,
           region_id = excluded.region_id,
           updated_at = excluded.updated_at`,
        [stop.osmId, stop.name, stop.lat, stop.lng, JSON.stringify(stop.tags), regionId, now],
      );
    }

    for (const route of data.routes) {
      const lats = route.geometry.map((p) => p[0]);
      const lngs = route.geometry.map((p) => p[1]);
      const south = lats.length > 0 ? Math.min(...lats) : bounds.south;
      const north = lats.length > 0 ? Math.max(...lats) : bounds.north;
      const west = lngs.length > 0 ? Math.min(...lngs) : bounds.west;
      const east = lngs.length > 0 ? Math.max(...lngs) : bounds.east;

      await db.runAsync(
        `INSERT INTO osm_transit_routes
           (osm_id, mode, ref, name, colour, geometry_json, stop_ids_json,
            south, west, north, east, region_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (osm_id) DO UPDATE SET
           mode = excluded.mode,
           ref = excluded.ref,
           name = excluded.name,
           colour = excluded.colour,
           geometry_json = excluded.geometry_json,
           stop_ids_json = excluded.stop_ids_json,
           south = excluded.south,
           west = excluded.west,
           north = excluded.north,
           east = excluded.east,
           region_id = excluded.region_id,
           updated_at = excluded.updated_at`,
        [
          route.osmId,
          route.mode,
          route.ref ?? null,
          route.name ?? null,
          route.colour ?? null,
          JSON.stringify(route.geometry),
          JSON.stringify(route.stopIds),
          south,
          west,
          north,
          east,
          regionId,
          now,
        ],
      );

      for (const stopId of route.stopIds) {
        await db.runAsync(
          `INSERT OR IGNORE INTO osm_transit_route_stops (stop_osm_id, route_osm_id)
           VALUES (?, ?)`,
          [stopId, route.osmId],
        );
      }
    }

    await db.runAsync(
      `INSERT INTO local_transit_coverage
         (region_id, south, west, north, east, stop_count, route_count, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (region_id) DO UPDATE SET
         south = excluded.south,
         west = excluded.west,
         north = excluded.north,
         east = excluded.east,
         stop_count = excluded.stop_count,
         route_count = excluded.route_count,
         updated_at = excluded.updated_at`,
      [
        regionId,
        bounds.south,
        bounds.west,
        bounds.north,
        bounds.east,
        data.stops.length,
        data.routes.length,
        now,
      ],
    );
  });
}

/**
 * Pack-side transit schema. The pack builder writes these three tables; the
 * importer attaches the file and copies them in with the region id stamped on.
 */
export const PACK_TRANSIT_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS osm_transit_stops (
    osm_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    tags_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS osm_transit_routes (
    osm_id INTEGER PRIMARY KEY,
    mode TEXT NOT NULL,
    ref TEXT,
    name TEXT,
    colour TEXT,
    geometry_json TEXT NOT NULL,
    stop_ids_json TEXT NOT NULL DEFAULT '[]',
    south REAL NOT NULL,
    west REAL NOT NULL,
    north REAL NOT NULL,
    east REAL NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS osm_transit_route_stops (
    stop_osm_id INTEGER NOT NULL,
    route_osm_id INTEGER NOT NULL,
    PRIMARY KEY (stop_osm_id, route_osm_id)
  );
`;

/**
 * Import a region pack's `transit.sqlite` into the local transit index.
 *
 * Runs as one transaction over an attached pack file: a truncated or corrupt
 * pack leaves the previously imported rows intact. Re-importing the same
 * region replaces its rows rather than duplicating them.
 */
export async function importLocalTransitIndexFromPack(
  packPath: string,
  regionId: string,
  bounds: TransitBounds,
): Promise<{ stops: number; routes: number }> {
  await ensureLocalTransitSchema();

  let counts: { stops: number; routes: number };
  try {
    counts = await importTransitRowsViaAttach(packPath, regionId);
  } catch (err) {
    // ATTACH is unavailable on some SQLite builds and sandboxed file providers.
    // Same pattern as the POI importer: fall back to a second read-only
    // connection and batched upserts.
    logDiagnostic('transit', 'warn', 'pack transit attach import failed, importing row-wise', {
      regionId,
      error: err instanceof Error ? err.message : String(err),
    });
    counts = await importTransitRowsRowWise(packPath, regionId);
  }

  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO local_transit_coverage
       (region_id, south, west, north, east, stop_count, route_count, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (region_id) DO UPDATE SET
       south = excluded.south,
       west = excluded.west,
       north = excluded.north,
       east = excluded.east,
       stop_count = excluded.stop_count,
       route_count = excluded.route_count,
       updated_at = excluded.updated_at`,
    [
      regionId,
      bounds.south,
      bounds.west,
      bounds.north,
      bounds.east,
      counts.stops,
      counts.routes,
      Date.now(),
    ],
  );

  return counts;
}

/** ATTACH + INSERT..SELECT fast path. */
async function importTransitRowsViaAttach(
  packPath: string,
  regionId: string,
): Promise<{ stops: number; routes: number }> {
  const db = await getDatabase();

  await db.runAsync(`ATTACH DATABASE '${packPath.replace(/'/g, "''")}' AS pack`);
  let stops = 0;
  let routes = 0;
  try {
    await db.withTransactionAsync(async () => {
      await db.runAsync(
        `DELETE FROM osm_transit_route_stops
          WHERE stop_osm_id IN (SELECT osm_id FROM osm_transit_stops WHERE region_id = ?)`,
        [regionId],
      );
      await db.runAsync('DELETE FROM osm_transit_stops WHERE region_id = ?', [regionId]);
      await db.runAsync('DELETE FROM osm_transit_routes WHERE region_id = ?', [regionId]);

      await db.runAsync(
        `INSERT INTO osm_transit_stops (osm_id, name, lat, lng, tags_json, region_id, updated_at)
         SELECT osm_id, name, lat, lng, tags_json, ?, updated_at FROM pack.osm_transit_stops`,
        [regionId],
      );
      await db.runAsync(
        `INSERT INTO osm_transit_routes
           (osm_id, mode, ref, name, colour, geometry_json, stop_ids_json,
            south, west, north, east, region_id, updated_at)
         SELECT osm_id, mode, ref, name, colour, geometry_json, stop_ids_json,
                south, west, north, east, ?, updated_at
           FROM pack.osm_transit_routes`,
        [regionId],
      );
      await db.runAsync(
        `INSERT OR IGNORE INTO osm_transit_route_stops (stop_osm_id, route_osm_id)
         SELECT stop_osm_id, route_osm_id FROM pack.osm_transit_route_stops`,
      );

      const stopCount = await db.getFirstAsync<{ n: number }>(
        'SELECT COUNT(*) AS n FROM pack.osm_transit_stops',
      );
      const routeCount = await db.getFirstAsync<{ n: number }>(
        'SELECT COUNT(*) AS n FROM pack.osm_transit_routes',
      );
      stops = stopCount?.n ?? 0;
      routes = routeCount?.n ?? 0;
    });
  } finally {
    await db.runAsync('DETACH DATABASE pack').catch(() => undefined);
  }

  return { stops, routes };
}

/** Second connection + batched upserts: works where ATTACH does not. */
async function importTransitRowsRowWise(
  packPath: string,
  regionId: string,
): Promise<{ stops: number; routes: number }> {
  const packDb = await SQLite.openDatabaseAsync(packPath, {
    finalizeUnusedStatementsBeforeClosing: false,
  });
  const db = await getDatabase();
  const now = Date.now();

  const BATCH = 500;
  let stops = 0;
  let routes = 0;

  try {
    await db.withTransactionAsync(async () => {
      await db.runAsync(
        `DELETE FROM osm_transit_route_stops
          WHERE stop_osm_id IN (SELECT osm_id FROM osm_transit_stops WHERE region_id = ?)`,
        [regionId],
      );
      await db.runAsync('DELETE FROM osm_transit_stops WHERE region_id = ?', [regionId]);
      await db.runAsync('DELETE FROM osm_transit_routes WHERE region_id = ?', [regionId]);
    });

    for (let offset = 0; ; offset += BATCH) {
      const rows = await packDb.getAllAsync<{
        osm_id: number;
        name: string;
        lat: number;
        lng: number;
        tags_json: string;
      }>(
        `SELECT osm_id, name, lat, lng, tags_json FROM osm_transit_stops
          ORDER BY osm_id LIMIT ? OFFSET ?`,
        [BATCH, offset],
      );
      if (rows.length === 0) break;

      await db.withTransactionAsync(async () => {
        for (const row of rows) {
          await db.runAsync(
            `INSERT INTO osm_transit_stops (osm_id, name, lat, lng, tags_json, region_id, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (osm_id) DO UPDATE SET
               name = excluded.name,
               lat = excluded.lat,
               lng = excluded.lng,
               tags_json = excluded.tags_json,
               region_id = excluded.region_id,
               updated_at = excluded.updated_at`,
            [row.osm_id, row.name, row.lat, row.lng, row.tags_json, regionId, now],
          );
        }
      });
      stops += rows.length;
    }

    for (let offset = 0; ; offset += BATCH) {
      const rows = await packDb.getAllAsync<{
        osm_id: number;
        mode: string;
        ref: string | null;
        name: string | null;
        colour: string | null;
        geometry_json: string;
        stop_ids_json: string;
        south: number;
        west: number;
        north: number;
        east: number;
        updated_at: number;
      }>(
        `SELECT osm_id, mode, ref, name, colour, geometry_json, stop_ids_json,
                south, west, north, east, updated_at
           FROM osm_transit_routes ORDER BY osm_id LIMIT ? OFFSET ?`,
        [BATCH, offset],
      );
      if (rows.length === 0) break;

      await db.withTransactionAsync(async () => {
        for (const row of rows) {
          await db.runAsync(
            `INSERT INTO osm_transit_routes
               (osm_id, mode, ref, name, colour, geometry_json, stop_ids_json,
                south, west, north, east, region_id, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (osm_id) DO UPDATE SET
               mode = excluded.mode,
               ref = excluded.ref,
               name = excluded.name,
               colour = excluded.colour,
               geometry_json = excluded.geometry_json,
               stop_ids_json = excluded.stop_ids_json,
               south = excluded.south,
               west = excluded.west,
               north = excluded.north,
               east = excluded.east,
               region_id = excluded.region_id,
               updated_at = excluded.updated_at`,
            [
              row.osm_id,
              row.mode,
              row.ref,
              row.name,
              row.colour,
              row.geometry_json,
              row.stop_ids_json,
              row.south,
              row.west,
              row.north,
              row.east,
              regionId,
              row.updated_at,
            ],
          );
        }
      });
      routes += rows.length;
    }

    const joins = await packDb.getAllAsync<{ stop_osm_id: number; route_osm_id: number }>(
      'SELECT stop_osm_id, route_osm_id FROM osm_transit_route_stops',
    );
    await db.withTransactionAsync(async () => {
      for (const join of joins) {
        await db.runAsync(
          'INSERT OR IGNORE INTO osm_transit_route_stops (stop_osm_id, route_osm_id) VALUES (?, ?)',
          [join.stop_osm_id, join.route_osm_id],
        );
      }
    });
  } finally {
    await packDb.closeAsync().catch(() => undefined);
  }

  return { stops, routes };
}
