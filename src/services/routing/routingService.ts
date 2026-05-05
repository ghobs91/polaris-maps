import * as Valhalla from '../../native/valhalla';
import { isOnline } from '../regions/connectivityService';
import type {
  ValhallaRoute,
  ValhallaManeuver,
  ManeuverType,
  CostingModel,
} from '../../models/route';

let initialized = false;

/** Public Valhalla API endpoints hosted by FOSSGIS/OpenStreetMap.
 *  valhalla1 and valhalla2 resolve to different IPs for hardware redundancy. */
const VALHALLA_ENDPOINTS = [
  'https://valhalla1.openstreetmap.de/route',
  'https://valhalla2.openstreetmap.de/route',
];

/** Per-endpoint timeout — if one endpoint is slow, we race the next. */
const ENDPOINT_TIMEOUT_MS = 8_000;

/** Map Valhalla HTTP maneuver type codes to our ManeuverType strings. */
function valhallaTypeCode(code: number): ManeuverType {
  switch (code) {
    case 1:
    case 2:
    case 3:
      return 'start';
    case 4:
    case 5:
    case 6:
      return 'destination';
    case 7:
      return 'name_change';
    case 8:
      return 'continue';
    case 9:
      return 'slight_right';
    case 10:
      return 'turn_right';
    case 11:
      return 'sharp_right';
    case 12:
    case 13:
      return 'u_turn';
    case 14:
      return 'sharp_left';
    case 15:
      return 'turn_left';
    case 16:
      return 'slight_left';
    case 17:
    case 22:
      return 'continue';
    case 18:
    case 19:
      return 'enter_highway';
    case 20:
    case 21:
      return 'exit_highway';
    case 23:
      return 'merge_right';
    case 24:
    case 25:
      return 'merge_left';
    case 26:
      return 'enter_roundabout';
    case 27:
      return 'exit_roundabout';
    case 28:
      return 'ferry';
    default:
      return 'continue';
  }
}

/** Wrap a routing error with a human-friendly message. */
function friendlyRoutingError(err: unknown): Error {
  if (err instanceof Error && err.name === 'AbortError') {
    return new Error(
      'Routing request timed out. The routing service may be temporarily unavailable. Please try again later.',
    );
  }
  if (err instanceof TypeError && err.message.includes('Network request failed')) {
    return new Error(
      'Unable to reach the routing service. Please check your internet connection and try again.',
    );
  }
  if (err instanceof Error) return err;
  return new Error(String(err));
}

/** Fetch from a single Valhalla endpoint with its own abort timeout.
 *  Throws on timeout, network error, or non-2xx response. */
async function fetchSingleEndpoint(
  endpoint: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ENDPOINT_TIMEOUT_MS);

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const raw = await res.text().catch(() => '');
      const safe = raw.slice(0, 200).replace(/key=[^&]*/g, 'key=REDACTED');
      throw new Error(`Online routing error ${res.status}: ${safe}`);
    }
    return res;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Race the routing request across all known Valhalla endpoints.
 *  First successful response wins; all others are cancelled via AbortController.
 *  If all endpoints fail, throws a combined error message. */
async function tryEndpoints(body: Record<string, unknown>): Promise<Response> {
  const errors: string[] = [];

  try {
    return await Promise.any(
      VALHALLA_ENDPOINTS.map(async (endpoint) => {
        try {
          return await fetchSingleEndpoint(endpoint, body);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`${endpoint}: ${msg}`);
          throw err;
        }
      }),
    );
  } catch {
    throw new Error(`All routing endpoints are currently unreachable.\n${errors.join('\n')}`);
  }
}

/** Compute routing via the public OSM Valhalla HTTP API. */
async function computeRouteOnline(
  waypoints: Array<{ lat: number; lng: number }>,
  costing: CostingModel,
  options?: {
    avoidTolls?: boolean;
    avoidHighways?: boolean;
    avoidFerries?: boolean;
    alternates?: number;
  },
): Promise<ValhallaRoute[]> {
  const body = {
    locations: waypoints.map((w) => ({ lat: w.lat, lon: w.lng, type: 'break' })),
    costing,
    alternates: options?.alternates ?? 0,
    costing_options: {
      [costing]: {
        use_tolls: options?.avoidTolls ? 0 : 1,
        use_highways: options?.avoidHighways ? 0 : 1,
        use_ferry: options?.avoidFerries ? 0 : 1,
      },
    },
    directions_options: { units: 'kilometers' },
  };

  let res: Response;
  try {
    res = await tryEndpoints(body);
  } catch (err: unknown) {
    throw friendlyRoutingError(err);
  }

  const json = (await res.json()) as Record<string, unknown>;
  const rawTrips = json['trip'] ? [json] : ((json['alternates'] as unknown[]) ?? [json]);
  const trips = rawTrips as Record<string, unknown>[];

  return trips.map((t) => {
    const trip = (t['trip'] ?? t) as Record<string, unknown>;
    const rawLegs = (trip['legs'] ?? []) as Record<string, unknown>[];
    const legs = rawLegs.map((leg) => ({
      maneuvers: ((leg['maneuvers'] ?? []) as Record<string, unknown>[]).map(
        (m): ValhallaManeuver => ({
          type: valhallaTypeCode((m['type'] as number) ?? 0),
          instruction: (m['instruction'] as string) ?? '',
          distanceMeters: ((m['length'] as number) ?? 0) * 1000,
          durationSeconds: (m['time'] as number) ?? 0,
          beginShapeIndex: (m['begin_shape_index'] as number) ?? 0,
          endShapeIndex: (m['end_shape_index'] as number) ?? 0,
          streetNames: m['street_names'] as string[] | undefined,
          verbalPreTransition: (m['verbal_pre_transition_instruction'] as string) ?? '',
          verbalPostTransition: m['verbal_post_transition_instruction'] as string | undefined,
        }),
      ),
      distanceMeters:
        (((leg['summary'] as Record<string, unknown>)?.['length'] as number) ?? 0) * 1000,
      durationSeconds: ((leg['summary'] as Record<string, unknown>)?.['time'] as number) ?? 0,
    }));

    const summary = (trip['summary'] ?? {}) as Record<string, unknown>;
    const firstLegShape =
      ((trip['legs'] as Record<string, unknown>[])?.[0]?.['shape'] as string) ?? '';
    return {
      summary: {
        distanceMeters: ((summary['length'] as number) ?? 0) * 1000,
        durationSeconds: (summary['time'] as number) ?? 0,
        hasToll: (summary['has_toll'] as boolean) ?? false,
        hasFerry: (summary['has_ferry'] as boolean) ?? false,
      },
      legs,
      geometry: firstLegShape,
      boundingBox: [
        (summary['min_lon'] as number) ?? waypoints[0].lng,
        (summary['min_lat'] as number) ?? waypoints[0].lat,
        (summary['max_lon'] as number) ?? waypoints[waypoints.length - 1].lng,
        (summary['max_lat'] as number) ?? waypoints[waypoints.length - 1].lat,
      ] as [number, number, number, number],
    } satisfies ValhallaRoute;
  });
}

export async function initRouting(graphTilePath: string): Promise<void> {
  await Valhalla.initialize({ graphTilePath });
  initialized = true;
}

/** Returns true if a local routing graph has been successfully loaded. */
export function isRoutingInitialized(): boolean {
  return initialized;
}

export async function computeRoute(
  waypoints: Array<{ lat: number; lng: number }>,
  costing: CostingModel,
  options?: {
    avoidTolls?: boolean;
    avoidHighways?: boolean;
    avoidFerries?: boolean;
    alternates?: number;
  },
): Promise<ValhallaRoute[]> {
  if (initialized) {
    return Valhalla.computeRoute(waypoints, costing, options);
  }
  // Local tiles not loaded — fall back to online Valhalla if connected
  if (!isOnline()) throw new Error('No offline routing data and no internet connection.');
  return computeRouteOnline(waypoints, costing, options);
}

export async function reroute(
  currentPosition: { lat: number; lng: number; bearing: number },
  destination: { lat: number; lng: number },
  costing: CostingModel,
): Promise<ValhallaRoute> {
  if (initialized) return Valhalla.reroute(currentPosition, destination, costing);
  if (!isOnline()) throw new Error('No offline routing data and no internet connection.');
  const routes = await computeRouteOnline(
    [{ lat: currentPosition.lat, lng: currentPosition.lng }, destination],
    costing,
  );
  if (!routes.length) throw new Error('No route found');
  return routes[0];
}

export async function updateTrafficSpeeds(speeds: Record<string, number>): Promise<void> {
  if (!initialized || !isOnline()) return;
  return Valhalla.updateTrafficSpeeds(speeds);
}

export async function hasCoverage(bounds: {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}): Promise<boolean> {
  if (!initialized) return false;
  return Valhalla.hasCoverage(bounds);
}

export async function getLoadedRegions(): Promise<
  Array<{ regionId: string; tilePath: string; sizeBytes: number }>
> {
  return Valhalla.getLoadedRegions();
}

export async function disposeRouting(): Promise<void> {
  if (!initialized) return;
  await Valhalla.dispose();
  initialized = false;
}
