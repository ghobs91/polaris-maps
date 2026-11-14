import { OTP_BASE_URL, OTP_GRAPHQL_PATH } from '../../constants/config';
import type { OtpItinerary, OtpStop, NearbyStop, TransitMode, LegMode } from '../../models/transit';
import { findEndpointForCoords, OTP_ENDPOINTS, type OtpEndpoint } from './otpEndpointRegistry';
import {
  TransitPlanError,
  decideTransitPlanTier,
  describeTransitPlanFailure,
  eligibleTransitPlanTiers,
  type LocalTimetableState,
  type TransitPlanFailureReason,
  type TransitPlanTier,
  type TransitousTierState,
} from './transitPlanTiers';
import { localTimetableAvailability, planWithLocalTimetable } from './transitTimetablePlanner';
import { planTransitousTrip } from './transitousRouting';
import { canUseTransitousPlan, noteTransitousPlan } from './transitousPlanBudget';
import { isTransitousPlanEnabled } from './transitousPlanPolicy';
import {
  applyRealtimeToItineraries,
  toLiveDepartures,
  firstTransitLegIndex,
} from './transitRealtimeOverlay';
import { fetchDepartures } from './transitDepartureFetcher';

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

/**
 * Format a Date for OTP1 REST `date` (MM-DD-YYYY) + `time` (h:mmam/pm)
 * params in the endpoint's timezone. OTP1 interprets date/time in the
 * graph's local timezone, so device-local formatting breaks cross-midnight
 * and non-local requests. Time uses the canonical lowercase no-space form
 * (e.g. "9:00am") instead of toLocaleTimeString's "9:00 AM".
 */
export function formatOtp1DateTime(
  dt: Date,
  timeZone?: string,
): { dateStr: string; timeStr: string } {
  // Avoid Intl.DateTimeFormat#formatToParts: several JS engines (notably
  // Hermes on iOS in some RN versions) ship a partial Intl where it throws.
  // Derive the parts from `.format()` output instead so a formatting quirk
  // can never abort the whole trip plan.
  try {
    const dateFormatted = new Intl.DateTimeFormat('en-US', {
      timeZone,
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
    }).format(dt);
    const [month, day, year] = dateFormatted.split(/\D+/);

    const timeFormatted = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(dt);
    const [hourRaw, minuteRaw] = timeFormatted.split(/\D+/);
    const hour24 = Number(hourRaw) % 24;
    const minute = (minuteRaw ?? '00').padStart(2, '0');
    const dayPeriod = hour24 >= 12 ? 'pm' : 'am';
    const hour12 = hour24 % 12 || 12;

    return {
      dateStr: `${month}-${day}-${year}`,
      timeStr: `${hour12}:${minute}${dayPeriod}`,
    };
  } catch {
    // Last-resort fallback: device-local wall clock (no timezone support).
    const month = String(dt.getMonth() + 1).padStart(2, '0');
    const day = String(dt.getDate()).padStart(2, '0');
    const hour24 = dt.getHours();
    const minute = String(dt.getMinutes()).padStart(2, '0');
    const dayPeriod = hour24 >= 12 ? 'pm' : 'am';
    const hour12 = hour24 % 12 || 12;
    return {
      dateStr: `${month}-${day}-${dt.getFullYear()}`,
      timeStr: `${hour12}:${minute}${dayPeriod}`,
    };
  }
}

async function planViaOtp1Rest(
  endpoint: OtpEndpoint,
  options: PlanTransitOptions,
): Promise<OtpItinerary[]> {
  const { from, to, departureTime, numItineraries = 5, isDepartAt } = options;

  const dt = departureTime ? new Date(departureTime) : new Date();
  const { dateStr, timeStr } = formatOtp1DateTime(dt, endpoint.timezone);

  const params = new URLSearchParams({
    fromPlace: `${from.lat},${from.lng}`,
    toPlace: `${to.lat},${to.lng}`,
    time: timeStr,
    date: dateStr,
    mode: 'TRANSIT,WALK',
    numItineraries: String(numItineraries),
    showIntermediateStops: 'true',
  });

  // OTP1 supports arriveBy as a boolean query param
  if (isDepartAt === false) {
    params.set('arriveBy', 'true');
  }

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
  /** When true, depart at `departureTime`; when false, arrive by `departureTime`. Defaults to true. */
  isDepartAt?: boolean;
  /** Transit modes to include. Defaults to all. */
  modes?: TransitMode[];
  /** Number of itineraries to request. Defaults to 5. */
  numItineraries?: number;
  /**
   * Ask a live source for the boarding leg's delay and apply it to the plan.
   *
   * Off by default: a Tier 0 plan is schedule-accurate and costs zero requests,
   * which is the whole point of the offline timetable. Callers that already have
   * a live departure source (the stop card does) opt in.
   */
  realtime?: boolean;
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
  const when = options.departureTime ? new Date(options.departureTime) : new Date();

  // Decide the eligible tiers *before* issuing any request, so an uncovered area
  // costs zero third-party calls. A try-then-fall-back chain would reach a
  // remote server for every uncovered user, which is the load profile the
  // offline packs exist to remove (see docs/scaling-p2p.md).
  const availability = await localTimetableAvailability(options.from, options.to, when);
  // The registry's last entry is a world-bbox Transitous catch-all. It is not a
  // regional endpoint — it is the `transitous` tier, reached only through its own
  // policy gate — so it must not be treated as one.
  const matched = findEndpointForCoords(options.from.lat, options.from.lng);
  const registryEndpoint = matched && matched.apiStyle !== 'transitous-v1' ? matched : null;
  const regional = registryEndpoint !== null || OTP_BASE_URL.length > 0;
  const transitous = transitousTierState();

  const input = {
    local: availability.state as LocalTimetableState,
    regional,
    transitous,
  };
  const tiers = eligibleTransitPlanTiers(input);

  if (tiers.length === 0) {
    const decision = decideTransitPlanTier(input);
    const reason: TransitPlanFailureReason = decision.reason ?? 'no-coverage';
    throw new TransitPlanError(reason, describeTransitPlanFailure(reason));
  }

  let lastError: unknown = null;

  for (const tier of tiers) {
    try {
      const itineraries = await planWithTier(tier, options, when, registryEndpoint);
      if (itineraries.length > 0) {
        return options.realtime ? await withRealtime(itineraries) : itineraries;
      }
    } catch (err) {
      lastError = err;
    }
  }

  // A tier answered but found no route: that is an empty result, not missing
  // data, so the caller keeps the "no itineraries" path it has always had.
  // Only a source that actually failed becomes an error.
  if (lastError) {
    const detail = lastError instanceof Error ? lastError.message : String(lastError);
    throw new TransitPlanError('upstream-failed', detail);
  }
  return [];
}

/** Current state of the Transitous tier for this device. */
function transitousTierState(): TransitousTierState {
  if (!isTransitousPlanEnabled()) return 'disabled';
  return canUseTransitousPlan() ? 'allowed' : 'budget-exhausted';
}

/** Run one tier. Throws on upstream failure; returns [] when it simply finds nothing. */
async function planWithTier(
  tier: TransitPlanTier,
  options: PlanTransitOptions,
  when: Date,
  registryEndpoint: OtpEndpoint | null,
): Promise<OtpItinerary[]> {
  switch (tier) {
    case 'local':
      return planWithLocalTimetable({
        from: options.from,
        to: options.to,
        departureTime: when,
        numItineraries: options.numItineraries,
      });

    case 'regional': {
      // A user-configured endpoint is what `EXPO_PUBLIC_OTP_BASE_URL` has always
      // meant, and it stays the fallback when a registry endpoint fails.
      if (!registryEndpoint) {
        return OTP_BASE_URL ? planViaUserConfiguredOtp(options) : [];
      }
      try {
        if (registryEndpoint.apiStyle === 'rest-v1') {
          return await planViaOtp1Rest(registryEndpoint, options);
        }
        if (registryEndpoint.apiStyle === 'transmodel-v3') {
          return await planViaTransmodelV3(registryEndpoint, options);
        }
        return await planViaGtfsGraphql(registryEndpoint, options);
      } catch (err) {
        if (!OTP_BASE_URL) throw err;
        return planViaUserConfiguredOtp(options);
      }
    }

    case 'transitous': {
      // Spend from the device budget only when a request is actually issued.
      noteTransitousPlan();
      const planned = await planTransitousTrip({
        originLat: options.from.lat,
        originLon: options.from.lng,
        destLat: options.to.lat,
        destLon: options.to.lng,
        time: when,
        arriveBy: options.isDepartAt === false,
        numItineraries: options.numItineraries,
      });
      return planned ?? [];
    }

    default:
      return [];
  }
}

/**
 * Apply live delays to the first boarding leg.
 *
 * Best-effort by construction: a live source that is slow, empty or broken must
 * leave the schedule-accurate plan untouched rather than fail the request.
 */
async function withRealtime(itineraries: OtpItinerary[]): Promise<OtpItinerary[]> {
  const index = firstTransitLegIndex(itineraries[0]);
  if (index === -1) return itineraries;

  const leg = itineraries[0].legs[index];
  const routeName = leg.route?.shortName ?? leg.route?.longName;
  if (!routeName) return itineraries;

  try {
    const info = await fetchDepartures(
      leg.from.name,
      leg.from.lat,
      leg.from.lon,
      [routeName],
      [leg.route?.color],
      [leg.route?.mode ?? 'RAIL'],
    );
    const live = toLiveDepartures(info.departures);
    return applyRealtimeToItineraries(itineraries, live);
  } catch {
    return itineraries;
  }
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
    modes = ['RAIL', 'SUBWAY', 'TRAM'],
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
    modes = ['RAIL', 'SUBWAY', 'TRAM'],
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
