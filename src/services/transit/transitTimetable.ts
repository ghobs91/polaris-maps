/**
 * On-device transit timetable (Tier 0 for journey planning).
 *
 * A region pack may ship `transit-timetable.sqlite`: the schedule side of the
 * feed that `transit.sqlite` deliberately omits. `transit.sqlite` answers "which
 * lines stop here" from OSM geometry; this answers "can I get from A to B, and
 * when", which needs actual stop times.
 *
 * ## Why it is a separate asset, and why it is not imported
 *
 * Stop times are large — CTA's `stop_times.txt` alone is ~192 MB uncompressed
 * (see the comment in `gtfsStaticFetcher`). Shipping them inside the map pack
 * would blow `AUTO_DOWNLOAD_MAX_BYTES`, so this is its own catalog asset that a
 * user only pays for when they want offline journey planning.
 *
 * For the same reason it is **opened where it lies** rather than copied into the
 * main database the way `search.sqlite`/`transit.sqlite` are: importing millions
 * of connection rows would double the bytes on disk and block the download for
 * minutes. The file is queried read-only through its own connection.
 *
 * ## Schema contract
 *
 * `TRANSIT_TIMETABLE_SCHEMA_SQL` must stay in lockstep with the builder
 * (`scripts/build-transit-timetable.py`), exactly like `PACK_TRANSIT_SCHEMA_SQL`
 * is mirrored by `scripts/osm-to-search-sqlite.py`. Bump
 * `TRANSIT_TIMETABLE_SCHEMA_VERSION` when the shape changes; a pack whose
 * `schema_version` differs is ignored rather than misread.
 */

import * as SQLite from 'expo-sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';

import { getStorageSync } from '../storage/mmkv';
import { logDiagnostic } from '../diagnostics/diagnosticsLog';

/** Schema version written into `timetable_meta`. */
export const TRANSIT_TIMETABLE_SCHEMA_VERSION = 1;

/** Catalog/pack asset name (re-exported so callers have one import site). */
export { TRANSIT_TIMETABLE_ASSET } from '../../constants/config';

export const TRANSIT_TIMETABLE_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS timetable_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS stops (
    id INTEGER PRIMARY KEY,
    stop_id TEXT NOT NULL,
    name TEXT NOT NULL,
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    parent TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_tt_stops_bounds ON stops (lat, lon);

  CREATE TABLE IF NOT EXISTS routes (
    id INTEGER PRIMARY KEY,
    short_name TEXT,
    long_name TEXT,
    color TEXT,
    mode TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY,
    days_mask INTEGER NOT NULL,
    start_date INTEGER NOT NULL,
    end_date INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS service_exceptions (
    service_id INTEGER NOT NULL,
    date INTEGER NOT NULL,
    exception_type INTEGER NOT NULL,
    PRIMARY KEY (service_id, date)
  );

  CREATE TABLE IF NOT EXISTS trips (
    id INTEGER PRIMARY KEY,
    service_id INTEGER NOT NULL,
    route_id INTEGER NOT NULL,
    headsign TEXT
  );

  CREATE TABLE IF NOT EXISTS connections (
    dep_s INTEGER NOT NULL,
    arr_s INTEGER NOT NULL,
    from_stop INTEGER NOT NULL,
    to_stop INTEGER NOT NULL,
    trip_id INTEGER NOT NULL,
    seq INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tt_connections_dep ON connections (dep_s);
  CREATE INDEX IF NOT EXISTS idx_tt_connections_trip ON connections (trip_id, seq);

  CREATE TABLE IF NOT EXISTS transfers (
    from_stop INTEGER NOT NULL,
    to_stop INTEGER NOT NULL,
    min_transfer_s INTEGER NOT NULL,
    PRIMARY KEY (from_stop, to_stop)
  );
`;

// ── Pure time helpers (unit tested) ──────────────────────────────────

/** Seconds in a day. GTFS allows times past 24h for overnight service. */
export const SECONDS_PER_DAY = 86_400;

/**
 * GTFS day bit for a date: bit 0 = Monday … bit 6 = Sunday.
 *
 * JS `getUTCDay()` is 0 = Sunday, so Monday-based feeds need the shift.
 */
export function dayBit(date: Date): number {
  return 1 << ((date.getUTCDay() + 6) % 7);
}

/** `YYYYMMDD` integer for a date, matching GTFS `start_date`/`end_date`. */
export function yyyymmdd(date: Date): number {
  return date.getUTCFullYear() * 10_000 + (date.getUTCMonth() + 1) * 100 + date.getUTCDate();
}

/** Seconds since local midnight for a date-time, clamped at 0. */
export function secondsSinceMidnight(date: Date): number {
  return date.getHours() * 3_600 + date.getMinutes() * 60 + date.getSeconds();
}

/**
 * The service day a query belongs to.
 *
 * A trip departing at 01:00 belongs to the *previous* service day when the feed
 * runs past midnight, so queries in the small hours look back one day and the
 * planner scans a window that crosses midnight.
 */
export function serviceDayFor(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// ── Registry (region → timetable file) ───────────────────────────────

const REGISTRY_KEY = 'transit.timetable.registry.v1';

export interface TimetableRegistration {
  regionId: string;
  path: string;
  bounds: { south: number; west: number; north: number; east: number };
  /** Epoch ms when the asset was installed, for diagnostics only. */
  installedAt: number;
}

export function readTimetableRegistry(): TimetableRegistration[] {
  try {
    const raw = getStorageSync().getString(REGISTRY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is TimetableRegistration =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as TimetableRegistration).path === 'string' &&
        typeof (entry as TimetableRegistration).regionId === 'string',
    );
  } catch {
    return [];
  }
}

/** Register (or replace) the timetable installed for a region. */
export function registerTimetable(registration: TimetableRegistration): void {
  try {
    const next = readTimetableRegistry().filter((r) => r.regionId !== registration.regionId);
    next.push(registration);
    getStorageSync().set(REGISTRY_KEY, JSON.stringify(next));
  } catch {
    logDiagnostic('transit', 'warn', 'could not persist timetable registry');
  }
}

/** Forget a region's timetable (region deleted). */
export function unregisterTimetable(regionId: string): void {
  try {
    const next = readTimetableRegistry().filter((r) => r.regionId !== regionId);
    getStorageSync().set(REGISTRY_KEY, JSON.stringify(next));
  } catch {
    // Non-fatal.
  }
}

/** The timetable registered for a coordinate, if any pack covers it. */
export function findTimetableFor(
  lat: number,
  lng: number,
  registry: readonly TimetableRegistration[] = readTimetableRegistry(),
): TimetableRegistration | null {
  for (const entry of registry) {
    const { south, west, north, east } = entry.bounds;
    if (lat >= south && lat <= north && lng >= west && lng <= east) return entry;
  }
  return null;
}

// ── Meta ─────────────────────────────────────────────────────────────

export interface TimetableMeta {
  schemaVersion: number;
  feedVersion: string;
  /** `YYYYMMDD`. */
  serviceStart: number;
  serviceEnd: number;
  tz?: string;
  connectionCount: number;
}

/** Read `timetable_meta` into a typed object. Returns null when unusable. */
export async function readTimetableMeta(db: SQLiteDatabase): Promise<TimetableMeta | null> {
  try {
    const rows = await db.getAllAsync<{ key: string; value: string }>(
      'SELECT key, value FROM timetable_meta',
    );
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const schemaVersion = Number(map.get('schema_version') ?? '0');
    if (!Number.isFinite(schemaVersion) || schemaVersion !== TRANSIT_TIMETABLE_SCHEMA_VERSION) {
      return null;
    }
    return {
      schemaVersion,
      feedVersion: map.get('feed_version') ?? '',
      serviceStart: Number(map.get('service_start') ?? '0'),
      serviceEnd: Number(map.get('service_end') ?? '0'),
      tz: map.get('tz'),
      connectionCount: Number(map.get('connection_count') ?? '0'),
    };
  } catch {
    return null;
  }
}

/**
 * Whether a timetable can answer a query for the given service day.
 *
 * `usable` requires the date to be inside the feed's service window; outside it
 * the planner must not answer, because a plan built from an out-of-date feed
 * looks correct and is not.
 */
export function timetableStateFor(
  meta: TimetableMeta | null,
  serviceDate: Date,
): 'usable' | 'absent' | 'expired' {
  if (!meta || meta.serviceStart === 0 || meta.serviceEnd === 0) return 'absent';
  const day = yyyymmdd(serviceDate);
  if (day < meta.serviceStart || day > meta.serviceEnd) return 'expired';
  return 'usable';
}

// ── Connections ──────────────────────────────────────────────────────

/** One connection scan record. Mirrors a `connections` row. */
export interface TimetableConnection {
  /** Seconds after service-day midnight. */
  depS: number;
  arrS: number;
  fromStop: number;
  toStop: number;
  tripId: number;
  seq: number;
}

export interface TimetableStop {
  id: number;
  name: string;
  lat: number;
  lon: number;
}

/** Upper bound on connections pulled for one query — bounds memory on device. */
export const MAX_CONNECTIONS_PER_QUERY = 200_000;

/**
 * Load the connections that can serve a query window on one service day.
 *
 * The join to `services` filters by weekday mask and service window, and the
 * `dep_s` index turns the time window into a range scan. `service_exceptions`
 * is applied afterwards because it is tiny and sparse.
 */
export async function loadConnections(
  db: SQLiteDatabase,
  options: { serviceDate: Date; windowStartS: number; windowEndS: number; limit?: number },
): Promise<TimetableConnection[]> {
  const { serviceDate, windowStartS, windowEndS } = options;
  const limit = options.limit ?? MAX_CONNECTIONS_PER_QUERY;
  const mask = dayBit(serviceDate);
  const day = yyyymmdd(serviceDate);

  const rows = await db.getAllAsync<{
    dep_s: number;
    arr_s: number;
    from_stop: number;
    to_stop: number;
    trip_id: number;
    seq: number;
  }>(
    `SELECT c.dep_s, c.arr_s, c.from_stop, c.to_stop, c.trip_id, c.seq
       FROM connections c
       JOIN trips t ON t.id = c.trip_id
       JOIN services s ON s.id = t.service_id
      WHERE c.dep_s >= ? AND c.dep_s <= ?
        AND (s.days_mask & ?) <> 0
        AND ? BETWEEN s.start_date AND s.end_date
        AND NOT EXISTS (
          SELECT 1 FROM service_exceptions e
           WHERE e.service_id = s.id AND e.date = ? AND e.exception_type = 2
        )
      ORDER BY c.dep_s
      LIMIT ?`,
    [windowStartS, windowEndS, mask, day, day, limit],
  );

  return rows.map((r) => ({
    depS: r.dep_s,
    arrS: r.arr_s,
    fromStop: r.from_stop,
    toStop: r.to_stop,
    tripId: r.trip_id,
    seq: r.seq,
  }));
}

/** Stops within `radiusMeters` of a point, nearest first. */
export async function findStopsNear(
  db: SQLiteDatabase,
  lat: number,
  lng: number,
  radiusMeters: number,
  limit = 24,
): Promise<TimetableStop[]> {
  // Degrees are ~111 km; pad the box so a cheap indexed prefilter cannot miss a
  // stop that is inside the circle but outside a naive lat/lon box.
  const dLat = radiusMeters / 111_320;
  const cosLat = Math.max(Math.cos((lat * Math.PI) / 180), 1e-6);
  const dLng = dLat / cosLat;

  const rows = await db.getAllAsync<{
    id: number;
    name: string;
    lat: number;
    lon: number;
  }>(
    `SELECT id, name, lat, lon FROM stops
      WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?
      LIMIT ?`,
    [lat - dLat, lat + dLat, lng - dLng, lng + dLng, limit * 8],
  );

  return rows
    .map((r) => ({ ...r, distance: haversineMeters(lat, lng, r.lat, r.lon) }))
    .filter((r) => r.distance <= radiusMeters)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
    .map(({ distance: _distance, ...stop }) => stop);
}

/** Great-circle distance in metres. */
export function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ── Connections to the database ──────────────────────────────────────

const openDbs = new Map<string, SQLiteDatabase>();

/** Open (and cache) a timetable file read-only. */
export async function openTimetable(path: string): Promise<SQLiteDatabase> {
  const cached = openDbs.get(path);
  if (cached) return cached;
  const db = await SQLite.openDatabaseAsync(path, { useNewConnection: true });
  openDbs.set(path, db);
  return db;
}

/** Drop a cached handle (region deleted / re-downloaded). */
export async function closeTimetable(path: string): Promise<void> {
  const db = openDbs.get(path);
  if (!db) return;
  openDbs.delete(path);
  try {
    await db.closeAsync();
  } catch {
    // Already closed.
  }
}

/** Test-only: forget every cached handle without touching disk. */
export function __resetTimetableHandlesForTests(): void {
  openDbs.clear();
}
