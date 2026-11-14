/**
 * Connection Scan Algorithm over an on-device timetable.
 *
 * CSA is the right fit for a phone: it needs the connections sorted by
 * departure time and nothing else — no graph build, no preprocessing, no
 * profile index — so it runs directly over the SQLite range scan in
 * `transitTimetable.loadConnections`. One round is O(connections); a plan with
 * at most K transit trips is K rounds.
 *
 * The rounds are RAPTOR-shaped: round `k` means "at most k transit trips",
 * boarding is checked against round `k-1`'s arrivals, and once a trip has been
 * boarded in a round, riding it is free for the rest of that round. That is what
 * keeps a transfer from costing a full extra round.
 *
 * ## What this deliberately does not do
 *
 * - **No realtime.** The timetable is the schedule; `transitRealtimeOverlay`
 *   applies live delays afterwards where a source offers them.
 * - **No shape geometry.** `shapes.txt` is not shipped (large, and mostly
 *   redundant at city scale), so a transit leg's polyline is its stop sequence —
 *   the same thing a rider reads off a route diagram.
 * - **No `frequencies.txt`.** Feeds that model service as headways rather than
 *   explicit departures are expanded at build time.
 */

import { encodePolyline } from '../../utils/polyline';
import type { LegMode, OtpItinerary, OtpLeg, TransitMode } from '../../models/transit';
import type { TimetableConnection, TimetableStop } from './transitTimetable';

// ── Catalog ──────────────────────────────────────────────────────────

export interface CsaTrip {
  routeId: number;
  headsign?: string;
}

export interface CsaRoute {
  shortName?: string;
  longName?: string;
  color?: string;
  mode: TransitMode;
}

/**
 * Metadata lookups the planner needs.
 *
 * Injected rather than imported so the algorithm stays pure and can be tested
 * without SQLite. The database-backed implementation lives in
 * `transitTimetablePlanner`.
 */
export interface CsaCatalog {
  stop(id: number): TimetableStop | undefined;
  trip(id: number): CsaTrip | undefined;
  route(id: number): CsaRoute | undefined;
}

/** A walk connection between the query point and a stop. */
export interface CsaAccessPoint {
  stopId: number;
  /** Walking seconds. */
  seconds: number;
}

export interface CsaQuery {
  /** Sorted ascending by `depS`. */
  connections: readonly TimetableConnection[];
  /** Origin → stop walking times. */
  access: readonly CsaAccessPoint[];
  /** Stop → destination walking times. */
  egress: readonly CsaAccessPoint[];
  /** Query time in seconds after service-day midnight. */
  departureS: number;
  /** Maximum transit trips in a plan (transfers = trips - 1). */
  maxTrips: number;
  /** Minimum seconds between alighting and the next boarding. */
  minTransferS: number;
  catalog: CsaCatalog;
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  /** Epoch ms of service-day midnight, used to build ISO timestamps. */
  serviceDayMs: number;
  /** Journeys to return. */
  numItineraries?: number;
}

// ── Tunables ─────────────────────────────────────────────────────────

/** Transfer buffer used when the feed ships no `transfers.txt` row. */
export const DEFAULT_MIN_TRANSFER_S = 120;

/** Walking speed for access/egress legs (m/s). */
export const DEFAULT_WALK_SPEED_MPS = 1.35;

/** Hard ceiling so a pathological feed cannot spin the UI thread. */
export const MAX_CSA_CONNECTIONS = 200_000;

/** Reconstruction guard: a malformed pack must never hang the UI. */
const MAX_JOURNEY_HOPS = 32;

const INF = Number.POSITIVE_INFINITY;

// ── Types ────────────────────────────────────────────────────────────

interface Arrival {
  conn: TimetableConnection;
  /** Stop where the passenger boarded the trip this connection belongs to. */
  boardStop: number;
  /** Sequence of the boarding connection, so intermediate stops are complete. */
  boardSeq: number;
}

interface OneJourney {
  /** Boarding-to-alighting hops, in travel order. */
  hops: Arrival[];
  egressStop: number;
  /** Seconds after service-day midnight the destination is reached. */
  egressArrivalS: number;
  /** Walking seconds from the alighting stop to the destination. */
  egressWalkS: number;
}

// ── Earliest arrival ─────────────────────────────────────────────────

/**
 * Run the rounds and return the earliest journey from `departureS`.
 *
 * Parents accumulate across rounds, so a journey that needs fewer trips than
 * `maxTrips` still reconstructs fully — the round that discovered each hop keeps
 * its record.
 */
function earliestJourney(query: CsaQuery, departureS: number): OneJourney | null {
  const best = new Map<number, number>();
  const parents = new Map<number, Arrival>();

  for (const point of query.access) {
    const at = departureS + point.seconds;
    const existing = best.get(point.stopId);
    if (existing === undefined || at < existing) best.set(point.stopId, at);
  }
  if (best.size === 0) return null;

  let previous = new Map(best);

  for (let trips = 1; trips <= query.maxTrips; trips++) {
    /** Trips already boarded this round — riding them costs no extra trip. */
    const boarded = new Map<number, { stop: number; seq: number }>();
    let improved = false;

    for (const conn of query.connections) {
      const alreadyOn = boarded.get(conn.tripId);

      if (alreadyOn === undefined) {
        const at = previous.get(conn.fromStop);
        if (at === undefined || at + query.minTransferS > conn.depS) continue;
        boarded.set(conn.tripId, { stop: conn.fromStop, seq: conn.seq });
      }

      const boarding = boarded.get(conn.tripId)!;
      const current = best.get(conn.toStop);
      if (current === undefined || conn.arrS < current) {
        best.set(conn.toStop, conn.arrS);
        parents.set(conn.toStop, {
          conn,
          boardStop: boarding.stop,
          boardSeq: boarding.seq,
        });
        improved = true;
      }
    }

    previous = new Map(best);
    if (!improved) break;
  }

  let egressStop = -1;
  let egressArrivalS = INF;
  let egressWalkS = 0;
  for (const point of query.egress) {
    const at = best.get(point.stopId);
    if (at === undefined) continue;
    const total = at + point.seconds;
    if (total < egressArrivalS) {
      egressArrivalS = total;
      egressStop = point.stopId;
      egressWalkS = point.seconds;
    }
  }
  if (egressStop < 0) return null;

  const hops: Arrival[] = [];
  let stop = egressStop;
  for (let guard = 0; guard < MAX_JOURNEY_HOPS; guard++) {
    const parent = parents.get(stop);
    if (!parent) break;
    hops.push(parent);
    // Stop walking back once the boarding stop was itself reached on foot.
    const earlier = parents.get(parent.boardStop);
    if (!earlier || earlier.conn.tripId === parent.conn.tripId) break;
    stop = parent.boardStop;
  }
  if (hops.length === 0) return null;

  return { hops: hops.reverse(), egressStop, egressArrivalS, egressWalkS };
}

// ── Leg construction ─────────────────────────────────────────────────

function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function walkLeg(
  from: { name: string; lat: number; lng: number },
  to: { name: string; lat: number; lng: number },
  startMs: number,
  endMs: number,
): OtpLeg {
  return {
    mode: 'WALK',
    from: { name: from.name, lat: from.lat, lon: from.lng },
    to: { name: to.name, lat: to.lat, lon: to.lng },
    startTime: startMs,
    endTime: endMs,
    duration: Math.max(0, Math.round((endMs - startMs) / 1000)),
    distance: haversineMeters(from.lat, from.lng, to.lat, to.lng),
    legGeometry: {
      points: encodePolyline(
        [
          [from.lat, from.lng],
          [to.lat, to.lng],
        ],
        5,
      ),
    },
  };
}

/** Group connections by trip so a leg can list its intermediate stops. */
function indexByTrip(
  connections: readonly TimetableConnection[],
): Map<number, TimetableConnection[]> {
  const byTrip = new Map<number, TimetableConnection[]>();
  for (const conn of connections) {
    const list = byTrip.get(conn.tripId);
    if (list) list.push(conn);
    else byTrip.set(conn.tripId, [conn]);
  }
  return byTrip;
}

/** Build the ordered transit legs for one reconstructed journey. */
function buildTransitLegs(
  hops: readonly Arrival[],
  query: CsaQuery,
  byTrip: Map<number, TimetableConnection[]>,
): OtpLeg[] {
  const legs: OtpLeg[] = [];

  for (const hop of hops) {
    const fromStop = query.catalog.stop(hop.boardStop);
    const toStop = query.catalog.stop(hop.conn.toStop);
    if (!fromStop || !toStop) continue;

    const trip = query.catalog.trip(hop.conn.tripId);
    const route = trip ? query.catalog.route(trip.routeId) : undefined;

    // Intermediate stops: this trip's connections from the boarding hop onward.
    const intermediateStops = (byTrip.get(hop.conn.tripId) ?? [])
      .filter((c) => c.seq >= hop.boardSeq && c.toStop !== hop.conn.toStop)
      .map((c) => query.catalog.stop(c.toStop))
      .filter((s): s is TimetableStop => s !== undefined)
      .map((s) => ({ name: s.name, lat: s.lat, lon: s.lon }));

    const points: [number, number][] = [
      [fromStop.lat, fromStop.lon],
      ...intermediateStops.map((s): [number, number] => [s.lat, s.lon]),
      [toStop.lat, toStop.lon],
    ];

    legs.push({
      mode: (route?.mode ?? 'BUS') as LegMode,
      from: {
        name: fromStop.name,
        lat: fromStop.lat,
        lon: fromStop.lon,
        stop: { gtfsId: String(hop.boardStop), name: fromStop.name },
      },
      to: {
        name: toStop.name,
        lat: toStop.lat,
        lon: toStop.lon,
        stop: { gtfsId: String(hop.conn.toStop), name: toStop.name },
      },
      startTime: query.serviceDayMs + hop.conn.depS * 1000,
      endTime: query.serviceDayMs + hop.conn.arrS * 1000,
      duration: Math.max(0, hop.conn.arrS - hop.conn.depS),
      distance: haversineMeters(fromStop.lat, fromStop.lon, toStop.lat, toStop.lon),
      route: route
        ? {
            gtfsId: String(trip?.routeId ?? ''),
            shortName: route.shortName,
            longName: route.longName,
            color: route.color,
            mode: route.mode,
          }
        : undefined,
      tripId: String(hop.conn.tripId),
      headsign: trip?.headsign,
      intermediateStops,
      legGeometry: { points: encodePolyline(points, 5) },
      realTime: false,
    });
  }

  return legs;
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Plan journeys over a timetable.
 *
 * Returns up to `numItineraries` distinct journeys, earliest arrival first, by
 * re-running from successively later departures. Output is the app's canonical
 * `OtpItinerary` shape, so callers never branch on which source answered.
 */
export function planWithCsa(query: CsaQuery): OtpItinerary[] {
  const connections = query.connections.slice(0, MAX_CSA_CONNECTIONS);
  if (connections.length === 0) return [];

  const byTrip = indexByTrip(connections);
  const wanted = Math.max(1, query.numItineraries ?? 3);
  const walkSpeed = DEFAULT_WALK_SPEED_MPS;

  const journeys: OtpItinerary[] = [];
  const seenStarts = new Set<number>();
  let departureS = query.departureS;

  for (let attempt = 0; attempt < wanted * 3 && journeys.length < wanted; attempt++) {
    const found = earliestJourney(query, departureS);
    if (!found) break;

    const legs = buildTransitLegs(found.hops, query, byTrip);
    if (legs.length === 0) break;

    const firstBoardingS = found.hops[0].conn.depS;
    if (seenStarts.has(firstBoardingS)) break;
    seenStarts.add(firstBoardingS);

    const originStop = query.catalog.stop(found.hops[0].boardStop);
    const destStop = query.catalog.stop(found.egressStop);

    if (originStop && destStop) {
      const accessWalkS = Math.max(
        0,
        Math.round(
          haversineMeters(query.origin.lat, query.origin.lng, originStop.lat, originStop.lon) /
            walkSpeed,
        ),
      );
      const accessLeg = walkLeg(
        { name: 'Origin', lat: query.origin.lat, lng: query.origin.lng },
        { name: originStop.name, lat: originStop.lat, lng: originStop.lon },
        query.serviceDayMs + (firstBoardingS - accessWalkS) * 1000,
        query.serviceDayMs + firstBoardingS * 1000,
      );

      const egressStartS = found.egressArrivalS - found.egressWalkS;
      const egressLeg = walkLeg(
        { name: destStop.name, lat: destStop.lat, lng: destStop.lon },
        { name: 'Destination', lat: query.destination.lat, lng: query.destination.lng },
        query.serviceDayMs + egressStartS * 1000,
        query.serviceDayMs + found.egressArrivalS * 1000,
      );

      const allLegs = [accessLeg, ...legs, egressLeg];
      const startMs = allLegs[0].startTime;
      const endMs = allLegs[allLegs.length - 1].endTime;
      const inVehicleS = legs.reduce((sum, leg) => sum + leg.duration, 0);
      const totalS = Math.max(0, Math.round((endMs - startMs) / 1000));
      const walkS = accessWalkS + found.egressWalkS;

      journeys.push({
        start: new Date(startMs).toISOString(),
        end: new Date(endMs).toISOString(),
        duration: totalS,
        walkDistance: accessLeg.distance + egressLeg.distance,
        waitingTime: Math.max(0, totalS - inVehicleS - walkS),
        transfers: Math.max(0, legs.length - 1),
        legs: allLegs,
      });
    }

    // Depart just after this journey's first boarding to find a different one.
    departureS = firstBoardingS + 1;
  }

  return journeys;
}
