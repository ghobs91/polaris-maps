/**
 * Local timetable planning (Tier 0).
 *
 * Glue between the pack's `transit-timetable.sqlite`, the connection scan in
 * `csaPlanner`, and the app's `OtpItinerary` contract. Everything here is
 * database-shaped; the algorithm itself is pure and lives in `csaPlanner`.
 *
 * ## Service days
 *
 * GTFS times are relative to the *service day*, and overnight trips are allowed
 * to run past 24:00 (`dep_s` > 86400). A query at 01:00 therefore belongs to
 * yesterday's service day, so early-morning queries are planned against both
 * days and the results merged. Outside that window a single pass is enough.
 */

import type { SQLiteDatabase } from 'expo-sqlite';

import type { OtpItinerary, TransitMode } from '../../models/transit';
import { logDiagnostic } from '../diagnostics/diagnosticsLog';
import {
  DEFAULT_MIN_TRANSFER_S,
  DEFAULT_WALK_SPEED_MPS,
  planWithCsa,
  type CsaAccessPoint,
  type CsaCatalog,
  type CsaQuery,
} from './csaPlanner';
import {
  findStopsNear,
  findTimetableFor,
  loadConnections,
  openTimetable,
  readTimetableMeta,
  readTimetableRegistry,
  secondsSinceMidnight,
  serviceDayFor,
  timetableStateFor,
  type TimetableConnection,
  type TimetableMeta,
  type TimetableRegistration,
  type TimetableStop,
} from './transitTimetable';

// ── Tunables ─────────────────────────────────────────────────────────

/** How far a rider is assumed to walk to reach a stop. */
export const MAX_ACCESS_WALK_M = 1_200;

/** Stops considered at each end of the journey. */
export const MAX_ACCESS_STOPS = 12;

/** How far ahead a plan may look for a departure. */
export const MAX_PLAN_WINDOW_S = 3 * 3_600;

/** Maximum transit trips in a plan (transfers = trips - 1). */
export const MAX_PLAN_TRIPS = 3;

/** Before this local hour, yesterday's service day is also considered. */
export const OVERNIGHT_LOOKBACK_HOUR = 4;

// ── Query shape ──────────────────────────────────────────────────────

export interface LocalPlanOptions {
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
  /** When the rider wants to leave. Defaults to now. */
  departureTime?: Date;
  numItineraries?: number;
  maxTrips?: number;
}

/** A service day a query may draw from. */
export interface ServiceDay {
  date: Date;
  /** Seconds added to `secondsSinceMidnight` for this service day. */
  offsetS: number;
}

/**
 * Service days worth scanning for a query time.
 *
 * Exported for tests: the early-morning lookback is easy to get wrong and
 * invisible without one.
 */
export function serviceDaysFor(when: Date, lookbackHour = OVERNIGHT_LOOKBACK_HOUR): ServiceDay[] {
  const days: ServiceDay[] = [];
  if (when.getHours() < lookbackHour) {
    const yesterday = new Date(when.getFullYear(), when.getMonth(), when.getDate() - 1);
    days.push({ date: yesterday, offsetS: 86_400 });
  }
  days.push({ date: serviceDayFor(when), offsetS: 0 });
  return days;
}

// ── Geo ──────────────────────────────────────────────────────────────

function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Walking times from each stop to a query point. */
function walkingPoints(
  stops: readonly TimetableStop[],
  target: { lat: number; lng: number },
): CsaAccessPoint[] {
  return stops.map((stop) => ({
    stopId: stop.id,
    seconds: Math.max(
      1,
      Math.round(
        haversineMeters(target.lat, target.lng, stop.lat, stop.lon) / DEFAULT_WALK_SPEED_MPS,
      ),
    ),
  }));
}

// ── Catalog hydration ────────────────────────────────────────────────

type TripRow = { routeId: number; headsign?: string };
type RouteRow = { shortName?: string; longName?: string; color?: string; mode: TransitMode };

/**
 * Load exactly the rows a plan can reference.
 *
 * Done up front rather than per lookup because the planner is synchronous —
 * that is what keeps it pure and unit-testable without a database.
 */
async function hydrateCatalog(
  db: SQLiteDatabase,
  connections: readonly TimetableConnection[],
  stops: Map<number, TimetableStop>,
  trips: Map<number, TripRow>,
  routes: Map<number, RouteRow>,
): Promise<void> {
  const stopIds = new Set<number>();
  const tripIds = new Set<number>();
  for (const conn of connections) {
    stopIds.add(conn.fromStop);
    stopIds.add(conn.toStop);
    tripIds.add(conn.tripId);
  }

  const inClause = (values: readonly number[]) => values.map(() => '?').join(',');

  const missingStops = [...stopIds].filter((id) => !stops.has(id));
  if (missingStops.length > 0) {
    const rows = await db.getAllAsync<{ id: number; name: string; lat: number; lon: number }>(
      `SELECT id, name, lat, lon FROM stops WHERE id IN (${inClause(missingStops)})`,
      missingStops,
    );
    for (const row of rows) stops.set(row.id, row);
  }

  const missingTrips = [...tripIds].filter((id) => !trips.has(id));
  if (missingTrips.length > 0) {
    const rows = await db.getAllAsync<{ id: number; route_id: number; headsign: string | null }>(
      `SELECT id, route_id, headsign FROM trips WHERE id IN (${inClause(missingTrips)})`,
      missingTrips,
    );
    for (const row of rows) {
      trips.set(row.id, { routeId: row.route_id, headsign: row.headsign ?? undefined });
    }
  }

  const routeIds = [...new Set([...trips.values()].map((t) => t.routeId))];
  const missingRoutes = routeIds.filter((id) => !routes.has(id));
  if (missingRoutes.length > 0) {
    const rows = await db.getAllAsync<{
      id: number;
      short_name: string | null;
      long_name: string | null;
      color: string | null;
      mode: string;
    }>(
      `SELECT id, short_name, long_name, color, mode FROM routes WHERE id IN (${inClause(missingRoutes)})`,
      missingRoutes,
    );
    for (const row of rows) {
      routes.set(row.id, {
        shortName: row.short_name ?? undefined,
        longName: row.long_name ?? undefined,
        color: row.color ?? undefined,
        mode: row.mode as TransitMode,
      });
    }
  }
}

// ── Coverage ─────────────────────────────────────────────────────────

export interface LocalTimetableAvailability {
  state: 'usable' | 'absent' | 'expired';
  registration: TimetableRegistration | null;
  meta: TimetableMeta | null;
}

/**
 * Whether an installed timetable can plan between two points on a date.
 *
 * Both endpoints must sit inside the same pack, and the date must be inside the
 * feed's service window. An expired feed reports `expired`, never `usable` —
 * callers use that to explain the failure instead of silently planning against
 * last month's schedule.
 */
export async function localTimetableAvailability(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  when: Date = new Date(),
  registry: readonly TimetableRegistration[] = readTimetableRegistry(),
): Promise<LocalTimetableAvailability> {
  const origin = findTimetableFor(from.lat, from.lng, registry);
  const dest = findTimetableFor(to.lat, to.lng, registry);
  if (!origin || !dest || origin.regionId !== dest.regionId) {
    return { state: 'absent', registration: null, meta: null };
  }

  try {
    const db = await openTimetable(origin.path);
    const meta = await readTimetableMeta(db);
    return { state: timetableStateFor(meta, when), registration: origin, meta };
  } catch (err) {
    logDiagnostic('transit', 'warn', 'timetable unavailable', {
      region: origin.regionId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { state: 'absent', registration: origin, meta: null };
  }
}

// ── Planning ─────────────────────────────────────────────────────────

/** Plan one service day. Returns [] when nothing connects. */
async function planServiceDay(
  db: SQLiteDatabase,
  options: LocalPlanOptions,
  day: ServiceDay,
  numItineraries: number,
  maxTrips: number,
): Promise<OtpItinerary[]> {
  const when = options.departureTime ?? new Date();
  const departureS = secondsSinceMidnight(when) + day.offsetS;

  const originStops = await findStopsNear(
    db,
    options.from.lat,
    options.from.lng,
    MAX_ACCESS_WALK_M,
    MAX_ACCESS_STOPS,
  );
  const destStops = await findStopsNear(
    db,
    options.to.lat,
    options.to.lng,
    MAX_ACCESS_WALK_M,
    MAX_ACCESS_STOPS,
  );
  if (originStops.length === 0 || destStops.length === 0) return [];

  const connections = await loadConnections(db, {
    serviceDate: day.date,
    windowStartS: departureS,
    windowEndS: departureS + MAX_PLAN_WINDOW_S,
  });
  if (connections.length === 0) return [];

  const stops = new Map<number, TimetableStop>();
  for (const stop of originStops) stops.set(stop.id, stop);
  for (const stop of destStops) stops.set(stop.id, stop);

  const trips = new Map<number, TripRow>();
  const routes = new Map<number, RouteRow>();
  await hydrateCatalog(db, connections, stops, trips, routes);

  const catalog: CsaCatalog = {
    stop: (id) => stops.get(id),
    trip: (id) => trips.get(id),
    route: (id) => routes.get(id),
  };

  const query: CsaQuery = {
    connections,
    access: walkingPoints(originStops, options.from),
    egress: walkingPoints(destStops, options.to),
    departureS,
    maxTrips,
    minTransferS: DEFAULT_MIN_TRANSFER_S,
    catalog,
    origin: options.from,
    destination: options.to,
    serviceDayMs: new Date(
      day.date.getFullYear(),
      day.date.getMonth(),
      day.date.getDate(),
    ).getTime(),
    numItineraries,
  };

  return planWithCsa(query);
}

/**
 * Plan a journey from an installed pack timetable.
 *
 * Returns `[]` when the timetable is absent, expired, or simply does not connect
 * the two points. Callers distinguish those cases with
 * {@link localTimetableAvailability} *before* calling, so an empty result here
 * means "no itinerary found", not "no data".
 */
export async function planWithLocalTimetable(options: LocalPlanOptions): Promise<OtpItinerary[]> {
  const when = options.departureTime ?? new Date();
  const availability = await localTimetableAvailability(options.from, options.to, when);
  if (availability.state !== 'usable' || !availability.registration) return [];

  const numItineraries = Math.max(1, options.numItineraries ?? 3);
  const maxTrips = Math.max(1, options.maxTrips ?? MAX_PLAN_TRIPS);

  try {
    const db = await openTimetable(availability.registration.path);

    const results: OtpItinerary[] = [];
    for (const day of serviceDaysFor(when)) {
      results.push(...(await planServiceDay(db, options, day, numItineraries, maxTrips)));
    }

    // Merge service days, earliest departure first, and drop duplicates.
    const seen = new Set<string>();
    return results
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
      .filter((it) => {
        const key = `${it.start}|${it.end}|${it.transfers}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, numItineraries);
  } catch (err) {
    logDiagnostic('transit', 'warn', 'local timetable plan failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}
