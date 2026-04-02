import { OTP_BASE_URL, OTP_GRAPHQL_PATH } from '../../constants/config';
import type { OtpItinerary, OtpStop, NearbyStop, TransitMode, LegMode } from '../../models/transit';

// ── GraphQL query fragments ─────────────────────────────────────────

const PLAN_QUERY = `
query PlanTrip(
  $fromLat: Float!, $fromLon: Float!,
  $toLat: Float!, $toLon: Float!,
  $dateTime: OffsetDateTime!,
  $transitModes: [TransitModeFilter!],
  $numItineraries: Int
) {
  planConnection(
    origin: { location: { coordinate: { latitude: $fromLat, longitude: $fromLon } } }
    destination: { location: { coordinate: { latitude: $toLat, longitude: $toLon } } }
    dateTime: { earliestDeparture: $dateTime }
    modes: {
      direct: [WALK]
      transit: { transit: $transitModes }
    }
    first: $numItineraries
  ) {
    edges {
      node {
        start
        end
        legs {
          mode
          from {
            name
            lat
            lon
            departure {
              scheduledTime
              estimated { time delay }
            }
            stop { gtfsId name code platformCode }
          }
          to {
            name
            lat
            lon
            arrival {
              scheduledTime
              estimated { time delay }
            }
            stop { gtfsId name code platformCode }
          }
          startTime
          endTime
          duration
          distance
          route {
            gtfsId shortName longName color textColor mode
            agency { gtfsId name }
          }
          trip { gtfsId }
          headsign
          intermediateStops {
            name lat lon
            arrival { scheduledTime estimated { time delay } }
            departure { scheduledTime estimated { time delay } }
          }
          legGeometry { points }
          realTime
          alerts {
            alertHeaderText
            alertDescriptionText
            alertUrl
          }
        }
      }
    }
  }
}`;

const STOPS_BY_BBOX_QUERY = `
query StopsByBBox($minLat: Float!, $minLon: Float!, $maxLat: Float!, $maxLon: Float!) {
  stopsByBbox(
    minLat: $minLat, minLon: $minLon,
    maxLat: $maxLat, maxLon: $maxLon
  ) {
    gtfsId
    name
    code
    lat
    lon
    routes {
      gtfsId shortName longName color textColor mode
      agency { gtfsId name }
    }
    vehicleMode
  }
}`;

const STOP_DEPARTURES_QUERY = `
query StopDepartures($stopId: String!, $numberOfDepartures: Int!) {
  stop(id: $stopId) {
    gtfsId
    name
    lat
    lon
    stoptimesWithoutPatterns(numberOfDepartures: $numberOfDepartures) {
      scheduledDeparture
      realtimeDeparture
      departureDelay
      realtime
      headsign
      trip {
        gtfsId
        route {
          shortName longName color mode
        }
      }
    }
  }
}`;

const NEARBY_STOPS_QUERY = `
query NearbyStops($lat: Float!, $lon: Float!, $radius: Int!, $maxResults: Int!) {
  nearest(lat: $lat, lon: $lon, maxDistance: $radius, maxResults: $maxResults, filterByPlaceTypes: [STOP]) {
    edges {
      node {
        distance
        place {
          ... on Stop {
            gtfsId
            name
            code
            lat
            lon
            routes {
              gtfsId shortName longName color textColor mode
              agency { gtfsId name }
            }
            vehicleMode
          }
        }
      }
    }
  }
}`;

// ── GraphQL client ──────────────────────────────────────────────────

async function otpQuery<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  if (!OTP_BASE_URL) throw new Error('EXPO_PUBLIC_OTP_BASE_URL is not configured');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20_000);

  const res = await fetch(`${OTP_BASE_URL}${OTP_GRAPHQL_PATH}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      OTPTimeout: '180000',
    },
    body: JSON.stringify({ query, variables }),
    signal: controller.signal,
  }).finally(() => clearTimeout(timeoutId));

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`OTP API error ${res.status}: ${text.slice(0, 300)}`);
  }

  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) {
    throw new Error(`OTP GraphQL error: ${json.errors[0].message}`);
  }
  if (!json.data) throw new Error('OTP returned no data');
  return json.data;
}

// ── Public API ──────────────────────────────────────────────────────

export interface PlanTransitOptions {
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
  /** ISO 8601 date-time string. Defaults to now. */
  departureTime?: string;
  /** Transit modes to include. Defaults to all. */
  modes?: TransitMode[];
  /** Number of itineraries to request. Defaults to 5. */
  numItineraries?: number;
}

/**
 * Plan a transit trip between two points using OpenTripPlanner.
 */
export async function planTransitTrip(options: PlanTransitOptions): Promise<OtpItinerary[]> {
  const {
    from,
    to,
    departureTime = new Date().toISOString(),
    modes = ['BUS', 'RAIL', 'SUBWAY', 'TRAM', 'FERRY'],
    numItineraries = 5,
  } = options;

  const transitModes = modes.map((m) => ({ mode: m }));

  const data = await otpQuery<{
    planConnection: {
      edges: Array<{
        node: {
          start: string;
          end: string;
          legs: Array<Record<string, unknown>>;
        };
      }>;
    };
  }>(PLAN_QUERY, {
    fromLat: from.lat,
    fromLon: from.lng,
    toLat: to.lat,
    toLon: to.lng,
    dateTime: departureTime,
    transitModes,
    numItineraries,
  });

  return data.planConnection.edges.map(({ node }) => {
    const legs = node.legs.map((leg) => ({
      mode: leg.mode as string as LegMode,
      from: leg.from as OtpItinerary['legs'][0]['from'],
      to: leg.to as OtpItinerary['legs'][0]['to'],
      startTime: leg.startTime as number,
      endTime: leg.endTime as number,
      duration: leg.duration as number,
      distance: leg.distance as number,
      route: leg.route as OtpItinerary['legs'][0]['route'] | undefined,
      tripId: (leg.trip as { gtfsId?: string } | undefined)?.gtfsId,
      headsign: leg.headsign as string | undefined,
      intermediateStops: leg.intermediateStops as OtpItinerary['legs'][0]['intermediateStops'],
      legGeometry: leg.legGeometry as { points: string },
      realTime: leg.realTime as boolean | undefined,
      alerts: leg.alerts as OtpItinerary['legs'][0]['alerts'],
    }));

    const totalDuration = legs.reduce((s, l) => s + l.duration, 0);
    const walkDistance = legs.filter((l) => l.mode === 'WALK').reduce((s, l) => s + l.distance, 0);
    const waitingTime = legs.reduce((sum, l, i) => {
      if (i === 0) return sum;
      const prevEnd = legs[i - 1].endTime;
      const gap = l.startTime - prevEnd;
      return sum + Math.max(0, gap);
    }, 0);
    const transfers = legs.filter((l) => l.mode !== 'WALK').length - 1;

    return {
      start: node.start,
      end: node.end,
      duration: totalDuration,
      walkDistance,
      waitingTime,
      transfers: Math.max(0, transfers),
      legs,
    } satisfies OtpItinerary;
  });
}

/**
 * Fetch transit stops within a bounding box (for map rendering).
 */
export async function getStopsInBounds(
  minLat: number,
  minLng: number,
  maxLat: number,
  maxLng: number,
): Promise<OtpStop[]> {
  const data = await otpQuery<{
    stopsByBbox: OtpStop[];
  }>(STOPS_BY_BBOX_QUERY, {
    minLat,
    minLon: minLng,
    maxLat,
    maxLon: maxLng,
  });

  return data.stopsByBbox;
}

/**
 * Fetch upcoming departures for a specific stop.
 */
export async function getStopDepartures(
  stopId: string,
  numberOfDepartures = 10,
): Promise<{
  stop: Pick<OtpStop, 'gtfsId' | 'name' | 'lat' | 'lon'>;
  departures: Array<{
    scheduledDeparture: number;
    realtimeDeparture: number;
    departureDelay: number;
    realtime: boolean;
    headsign: string;
    trip: {
      gtfsId: string;
      route: { shortName?: string; longName?: string; color?: string; mode: string };
    };
  }>;
}> {
  const data = await otpQuery<{
    stop: {
      gtfsId: string;
      name: string;
      lat: number;
      lon: number;
      stoptimesWithoutPatterns: Array<{
        scheduledDeparture: number;
        realtimeDeparture: number;
        departureDelay: number;
        realtime: boolean;
        headsign: string;
        trip: {
          gtfsId: string;
          route: { shortName?: string; longName?: string; color?: string; mode: string };
        };
      }>;
    };
  }>(STOP_DEPARTURES_QUERY, {
    stopId,
    numberOfDepartures,
  });

  return {
    stop: {
      gtfsId: data.stop.gtfsId,
      name: data.stop.name,
      lat: data.stop.lat,
      lon: data.stop.lon,
    },
    departures: data.stop.stoptimesWithoutPatterns,
  };
}

/**
 * Fetch transit stops near a point (for "nearby departures" feature).
 */
export async function getNearbyStops(
  lat: number,
  lng: number,
  radiusMeters = 500,
  maxResults = 20,
): Promise<NearbyStop[]> {
  const data = await otpQuery<{
    nearest: {
      edges: Array<{
        node: {
          distance: number;
          place: OtpStop;
        };
      }>;
    };
  }>(NEARBY_STOPS_QUERY, {
    lat,
    lon: lng,
    radius: radiusMeters,
    maxResults,
  });

  return data.nearest.edges.map(({ node }) => ({
    stop: node.place,
    distanceMeters: node.distance,
    departures: [], // Filled by a follow-up getStopDepartures call
  }));
}

/** Check if OTP is configured. */
export function isOtpConfigured(): boolean {
  return !!OTP_BASE_URL;
}
