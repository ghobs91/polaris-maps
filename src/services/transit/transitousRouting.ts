/**
 * Transitous MOTIS 2 routing adapter.
 *
 * Calls the MOTIS `/api/v5/plan` endpoint and maps the response to the
 * existing `OtpItinerary` model used throughout the app.
 */

import {
  planMotisTrip,
  motisLegMode,
  motisRouteTypeToTransit,
  type MotisPlanResponse,
  type MotisLeg,
} from './transitousClient';
import type { OtpItinerary, LegMode, TransitMode } from '../../models/transit';

// ── Helpers ───────────────────────────────────────────────────────────

function mapMotisLeg(leg: MotisLeg): OtpItinerary['legs'][number] {
  const mode = motisLegMode(leg.mode) as LegMode;

  const motisRoute = leg.transit?.route;
  const transit: OtpItinerary['legs'][number]['route'] = motisRoute
    ? {
        gtfsId: motisRoute.gtfsId ?? '',
        shortName: motisRoute.shortName,
        longName: motisRoute.longName,
        color: motisRoute.color,
        mode: motisRouteTypeToTransit(motisRoute.type) as TransitMode,
      }
    : undefined;

  const intermediateStops =
    leg.transit?.intermediateStops?.map((s) => ({
      name: s.name,
      lat: s.lat,
      lon: s.lon,
    })) ?? [];

  return {
    mode,
    from: {
      name: leg.from.name,
      lat: leg.from.lat,
      lon: leg.from.lon,
    },
    to: {
      name: leg.to.name,
      lat: leg.to.lat,
      lon: leg.to.lon,
    },
    startTime: new Date(leg.startTime).getTime(),
    endTime: new Date(leg.endTime).getTime(),
    duration: leg.duration,
    distance: leg.distance ?? 0,
    route: transit,
    headsign: leg.transit?.headSign,
    intermediateStops,
    legGeometry: { points: leg.geometry ?? '' },
    realTime: leg.realTime ?? false,
  };
}

function mapMotisItinerary(it: MotisPlanResponse['itineraries'][number]): OtpItinerary {
  return {
    start: it.startTime,
    end: it.endTime,
    duration: it.duration,
    walkDistance: it.walkDistance ?? 0,
    waitingTime: it.waitingTime ?? 0,
    transfers: it.transfers,
    legs: it.legs.map(mapMotisLeg),
  };
}

// ── Public API ────────────────────────────────────────────────────────

export interface TransitousTripParams {
  originLat: number;
  originLon: number;
  destLat: number;
  destLon: number;
  time?: Date;
  arriveBy?: boolean;
  numItineraries?: number;
  maxTransfers?: number;
  timeoutMs?: number;
}

/**
 * Plan a transit trip via Transitous and return OtpItinerary[].
 * Returns null on failure (caller should fall back to OTP).
 */
export async function planTransitousTrip(
  params: TransitousTripParams,
): Promise<OtpItinerary[] | null> {
  const response = await planMotisTrip({
    fromPlace: `${params.originLat},${params.originLon}`,
    toPlace: `${params.destLat},${params.destLon}`,
    time: params.time?.toISOString(),
    arriveBy: params.arriveBy,
    numItineraries: params.numItineraries ?? 3,
    maxTransfers: params.maxTransfers,
    transitModes: 'TRANSIT',
    timeoutMs: params.timeoutMs,
  });

  if (!response?.itineraries?.length) return null;

  return response.itineraries.map(mapMotisItinerary);
}
