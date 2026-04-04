import { OTP_BASE_URL, OTP_GRAPHQL_PATH } from '../../constants/config';
import type { OtpItinerary, OtpStop, NearbyStop, TransitMode, LegMode } from '../../models/transit';
import { findEndpointForCoords, OTP_ENDPOINTS, type OtpEndpoint } from './otpEndpointRegistry';

// ── GraphQL query fragments (OTP2 GTFS GraphQL — used by user-configured endpoint) ──

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

// ── Transmodel v3 query (Entur-style OTP2) ──────────────────────────

const TRANSMODEL_PLAN_QUERY = `
query PlanTrip(
  $fromLat: Float!, $fromLon: Float!,
  $toLat: Float!, $toLon: Float!,
  $dateTime: DateTime!,
  $numTripPatterns: Int
) {
  trip(
    from: { coordinates: { latitude: $fromLat, longitude: $fromLon } }
    to: { coordinates: { latitude: $toLat, longitude: $toLon } }
    dateTime: $dateTime
    numTripPatterns: $numTripPatterns
    modes: {
      accessMode: foot
      egressMode: foot
      transportModes: [
        { transportMode: bus }
        { transportMode: rail }
        { transportMode: metro }
        { transportMode: tram }
        { transportMode: water }
      ]
    }
  ) {
    tripPatterns {
      duration
      startTime
      endTime
      walkDistance
      legs {
        mode
        fromPlace { name latitude longitude }
        toPlace { name latitude longitude }
        expectedStartTime
        expectedEndTime
        duration
        distance
        line { publicCode name presentation { colour textColour } authority { name } }
        fromEstimatedCall { destinationDisplay { frontText } }
        intermediateEstimatedCalls {
          quay { name latitude longitude }
          expectedArrivalTime
          expectedDepartureTime
        }
        pointsOnLink { points }
        realtime
        situations {
          summary { value }
          description { value }
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

// ── GraphQL client (OTP2 GTFS — user-configured endpoint) ───────────

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

// ── OTP1 REST client (MTA, TriMet, etc.) ────────────────────────────

interface Otp1Itinerary {
  duration: number;
  startTime: number;
  startTimeFmt?: string;
  endTime: number;
  endTimeFmt?: string;
  walkTime: number;
  transitTime: number;
  waitingTime: number;
  walkDistance: number;
  transfers: number;
  legs: Array<{
    startTime: number;
    startTimeFmt?: string;
    endTime: number;
    endTimeFmt?: string;
    mode: string;
    route?: string;
    routeShortName?: string;
    routeLongName?: string;
    routeColor?: string;
    routeTextColor?: string;
    agencyName?: string;
    headsign?: string;
    from: { name: string; lat: number; lon: number; stopId?: string; stopCode?: string };
    to: { name: string; lat: number; lon: number; stopId?: string; stopCode?: string };
    duration: number;
    distance: number;
    legGeometry: { points: string; length: number };
    realTime?: boolean;
    intermediateStops?: Array<{
      name: string;
      lat: number;
      lon: number;
      arrival: number;
      departure: number;
    }>;
    alerts?: Array<{
      alertHeaderText?: string;
      alertDescriptionText?: string;
      alertUrl?: string;
    }>;
  }>;
}

function modeStringToLegMode(m: string): LegMode {
  const upper = m.toUpperCase();
  if (upper === 'WALK' || upper === 'BICYCLE') return upper as LegMode;
  if (upper === 'SUBWAY' || upper === 'METRO') return 'SUBWAY';
  if (upper === 'RAIL' || upper === 'COMMUTER_RAIL') return 'RAIL';
  if (upper === 'TRAM' || upper === 'LIGHT_RAIL') return 'TRAM';
  if (upper === 'FERRY') return 'FERRY';
  if (upper === 'CABLE_CAR') return 'CABLE_CAR';
  if (upper === 'GONDOLA') return 'GONDOLA';
  if (upper === 'FUNICULAR') return 'FUNICULAR';
  if (upper === 'BUS') return 'BUS';
  return 'BUS'; // default
}

function otp1ItineraryToOtp(raw: Otp1Itinerary): OtpItinerary {
  const legs = raw.legs.map((leg) => ({
    mode: modeStringToLegMode(leg.mode),
    from: {
      name: leg.from.name,
      lat: leg.from.lat,
      lon: leg.from.lon,
      stop: leg.from.stopId
        ? { gtfsId: leg.from.stopId, name: leg.from.name, code: leg.from.stopCode }
        : undefined,
    },
    to: {
      name: leg.to.name,
      lat: leg.to.lat,
      lon: leg.to.lon,
      stop: leg.to.stopId
        ? { gtfsId: leg.to.stopId, name: leg.to.name, code: leg.to.stopCode }
        : undefined,
    },
    startTime: leg.startTime,
    endTime: leg.endTime,
    duration: leg.duration,
    distance: leg.distance,
    route:
      leg.routeShortName || leg.routeLongName
        ? {
            gtfsId: '',
            shortName: leg.routeShortName,
            longName: leg.routeLongName,
            color: leg.routeColor,
            textColor: leg.routeTextColor,
            mode: modeStringToLegMode(leg.mode) as TransitMode,
            agency: leg.agencyName ? { gtfsId: '', name: leg.agencyName } : undefined,
          }
        : undefined,
    headsign: leg.headsign,
    intermediateStops: leg.intermediateStops?.map((s) => ({
      name: s.name,
      lat: s.lat,
      lon: s.lon,
    })),
    legGeometry: { points: leg.legGeometry.points },
    realTime: leg.realTime,
    alerts: leg.alerts,
  }));

  const start = raw.startTimeFmt ?? new Date(raw.startTime).toISOString();
  const end = raw.endTimeFmt ?? new Date(raw.endTime).toISOString();

  return {
    start,
    end,
    duration: raw.duration,
    walkDistance: raw.walkDistance,
    waitingTime: raw.waitingTime,
    transfers: raw.transfers,
    legs,
  };
}

async function planViaOtp1Rest(
  endpoint: OtpEndpoint,
  options: PlanTransitOptions,
): Promise<OtpItinerary[]> {
  const { from, to, departureTime, numItineraries = 5 } = options;

  const dt = departureTime ? new Date(departureTime) : new Date();
  const timeStr = dt.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  const month = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  const dateStr = `${month}-${day}-${dt.getFullYear()}`;

  const params = new URLSearchParams({
    fromPlace: `${from.lat},${from.lng}`,
    toPlace: `${to.lat},${to.lng}`,
    time: timeStr,
    date: dateStr,
    mode: 'TRANSIT,WALK',
    numItineraries: String(numItineraries),
    showIntermediateStops: 'true',
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20_000);

  const res = await fetch(`${endpoint.url}?${params.toString()}`, {
    headers: endpoint.headers ?? {},
    signal: controller.signal,
  }).finally(() => clearTimeout(timeoutId));

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`OTP1 REST error ${res.status}: ${text.slice(0, 300)}`);
  }

  const json = (await res.json()) as {
    plan?: { itineraries: Otp1Itinerary[] };
    error?: { message: string };
  };

  if (json.error) throw new Error(`OTP1: ${json.error.message}`);
  if (!json.plan?.itineraries) return [];

  return json.plan.itineraries.map(otp1ItineraryToOtp);
}

// ── Transmodel v3 client (Entur) ────────────────────────────────────

function transmodelModeToLegMode(m: string): LegMode {
  const lower = m.toLowerCase();
  if (lower === 'foot') return 'WALK';
  if (lower === 'bicycle') return 'BICYCLE';
  if (lower === 'metro') return 'SUBWAY';
  if (lower === 'rail') return 'RAIL';
  if (lower === 'tram') return 'TRAM';
  if (lower === 'bus' || lower === 'coach') return 'BUS';
  if (lower === 'water') return 'FERRY';
  return 'BUS';
}

async function planViaTransmodelV3(
  endpoint: OtpEndpoint,
  options: PlanTransitOptions,
): Promise<OtpItinerary[]> {
  const { from, to, departureTime, numItineraries = 5 } = options;
  const dt = departureTime ?? new Date().toISOString();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20_000);

  const res = await fetch(endpoint.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(endpoint.headers ?? {}),
    },
    body: JSON.stringify({
      query: TRANSMODEL_PLAN_QUERY,
      variables: {
        fromLat: from.lat,
        fromLon: from.lng,
        toLat: to.lat,
        toLon: to.lng,
        dateTime: dt,
        numTripPatterns: numItineraries,
      },
    }),
    signal: controller.signal,
  }).finally(() => clearTimeout(timeoutId));

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Transmodel API error ${res.status}: ${text.slice(0, 300)}`);
  }

  const json = (await res.json()) as {
    data?: {
      trip: {
        tripPatterns: Array<{
          duration: number;
          startTime: string;
          endTime: string;
          walkDistance?: number;
          legs: Array<Record<string, unknown>>;
        }>;
      };
    };
    errors?: Array<{ message: string }>;
  };

  if (json.errors?.length) throw new Error(`Transmodel error: ${json.errors[0].message}`);
  if (!json.data?.trip?.tripPatterns) return [];

  return json.data.trip.tripPatterns.map((tp) => {
    const legs = tp.legs.map((leg) => {
      const fromPlace = leg.fromPlace as { name: string; latitude: number; longitude: number };
      const toPlace = leg.toPlace as { name: string; latitude: number; longitude: number };
      const line = leg.line as {
        publicCode?: string;
        name?: string;
        presentation?: { colour?: string; textColour?: string };
        authority?: { name: string };
      } | null;
      const frontText = (
        leg.fromEstimatedCall as { destinationDisplay?: { frontText?: string } } | null
      )?.destinationDisplay?.frontText;
      const intermediates =
        (leg.intermediateEstimatedCalls as
          | Array<{
              quay: { name: string; latitude: number; longitude: number };
              expectedArrivalTime?: string;
              expectedDepartureTime?: string;
            }>
          | undefined) ?? [];
      const situations =
        (leg.situations as
          | Array<{
              summary: { value: string }[];
              description: { value: string }[];
            }>
          | undefined) ?? [];
      const points = (leg.pointsOnLink as { points?: string } | null)?.points ?? '';

      return {
        mode: transmodelModeToLegMode(leg.mode as string),
        from: { name: fromPlace.name, lat: fromPlace.latitude, lon: fromPlace.longitude },
        to: { name: toPlace.name, lat: toPlace.latitude, lon: toPlace.longitude },
        startTime: new Date(leg.expectedStartTime as string).getTime(),
        endTime: new Date(leg.expectedEndTime as string).getTime(),
        duration: leg.duration as number,
        distance: (leg.distance as number) ?? 0,
        route: line
          ? {
              gtfsId: '',
              shortName: line.publicCode,
              longName: line.name,
              color: line.presentation?.colour?.replace('#', ''),
              textColor: line.presentation?.textColour?.replace('#', ''),
              mode: transmodelModeToLegMode(leg.mode as string) as TransitMode,
              agency: line.authority ? { gtfsId: '', name: line.authority.name } : undefined,
            }
          : undefined,
        headsign: frontText,
        intermediateStops: intermediates.map((s) => ({
          name: s.quay.name,
          lat: s.quay.latitude,
          lon: s.quay.longitude,
        })),
        legGeometry: { points },
        realTime: leg.realtime as boolean | undefined,
        alerts: situations.map((s) => ({
          alertHeaderText: s.summary?.[0]?.value,
          alertDescriptionText: s.description?.[0]?.value,
        })),
      };
    });

    const walkDistance =
      tp.walkDistance ?? legs.filter((l) => l.mode === 'WALK').reduce((s, l) => s + l.distance, 0);
    const waitingTime = legs.reduce((sum, l, i) => {
      if (i === 0) return sum;
      const gap = l.startTime - legs[i - 1].endTime;
      return sum + Math.max(0, gap);
    }, 0);
    const transfers = legs.filter((l) => l.mode !== 'WALK').length - 1;

    return {
      start: tp.startTime,
      end: tp.endTime,
      duration: tp.duration,
      walkDistance,
      waitingTime,
      transfers: Math.max(0, transfers),
      legs,
    } satisfies OtpItinerary;
  });
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
 * Plan a transit trip between two points.
 *
 * Resolution order:
 *   1. Registry endpoint matching origin coordinates
 *   2. User-configured OTP_BASE_URL (OTP2 GTFS GraphQL)
 *   3. Throws — caller should fall back to local planner
 */
export async function planTransitTrip(options: PlanTransitOptions): Promise<OtpItinerary[]> {
  // 1. Try registry endpoint for origin coordinates
  const registryEndpoint = findEndpointForCoords(options.from.lat, options.from.lng);
  if (registryEndpoint) {
    try {
      if (registryEndpoint.apiStyle === 'rest-v1') {
        return await planViaOtp1Rest(registryEndpoint, options);
      }
      if (registryEndpoint.apiStyle === 'transmodel-v3') {
        return await planViaTransmodelV3(registryEndpoint, options);
      }
      // gtfs-graphql-v2 — use existing GraphQL client with registry URL
      return await planViaGtfsGraphql(registryEndpoint, options);
    } catch {
      // Registry endpoint failed; try user-configured fallback
    }
  }

  // 2. User-configured OTP_BASE_URL
  if (OTP_BASE_URL) {
    return planViaUserConfiguredOtp(options);
  }

  // 3. No endpoint available
  throw new Error('No OTP endpoint available for this region');
}

/** Plan via a GTFS GraphQL v2 registry endpoint. */
async function planViaGtfsGraphql(
  endpoint: OtpEndpoint,
  options: PlanTransitOptions,
): Promise<OtpItinerary[]> {
  const {
    from,
    to,
    departureTime = new Date().toISOString(),
    modes = ['BUS', 'RAIL', 'SUBWAY', 'TRAM', 'FERRY'],
    numItineraries = 5,
  } = options;

  const transitModes = modes.map((m) => ({ mode: m }));

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20_000);

  const res = await fetch(endpoint.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(endpoint.headers ?? {}),
    },
    body: JSON.stringify({
      query: PLAN_QUERY,
      variables: {
        fromLat: from.lat,
        fromLon: from.lng,
        toLat: to.lat,
        toLon: to.lng,
        dateTime: departureTime,
        transitModes,
        numItineraries,
      },
    }),
    signal: controller.signal,
  }).finally(() => clearTimeout(timeoutId));

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`OTP GTFS GraphQL error ${res.status}: ${text.slice(0, 300)}`);
  }

  const json = (await res.json()) as {
    data?: {
      planConnection: {
        edges: Array<{
          node: { start: string; end: string; legs: Array<Record<string, unknown>> };
        }>;
      };
    };
    errors?: Array<{ message: string }>;
  };

  if (json.errors?.length) throw new Error(`OTP GraphQL error: ${json.errors[0].message}`);
  if (!json.data?.planConnection?.edges) return [];

  return parseGtfsGraphqlEdges(json.data.planConnection.edges);
}

/** Plan via user-configured OTP_BASE_URL (OTP2 GTFS GraphQL). */
async function planViaUserConfiguredOtp(options: PlanTransitOptions): Promise<OtpItinerary[]> {
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

  return parseGtfsGraphqlEdges(data.planConnection.edges);
}

/** Parse OTP2 GTFS GraphQL planConnection edges into OtpItinerary[]. */
function parseGtfsGraphqlEdges(
  edges: Array<{ node: { start: string; end: string; legs: Array<Record<string, unknown>> } }>,
): OtpItinerary[] {
  return edges.map(({ node }) => {
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

/**
 * Check if OTP is available — either via user-configured base URL
 * or registry endpoints exist. Optionally pass coordinates to check
 * for a specific location.
 */
export function isOtpConfigured(lat?: number, lon?: number): boolean {
  if (OTP_BASE_URL) return true;
  if (lat != null && lon != null) return !!findEndpointForCoords(lat, lon);
  // If no coords, return true if any registry entries exist
  return OTP_ENDPOINTS.length > 0;
}

/** Check if the user has explicitly set EXPO_PUBLIC_OTP_BASE_URL. */
export function isUserOtpConfigured(): boolean {
  return !!OTP_BASE_URL;
}
