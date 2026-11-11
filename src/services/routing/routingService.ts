import * as Valhalla from '../../native/valhalla';
import * as MapKitRouting from '../../native/mapkit';
import { computeOsrmRoute, isOsrmSupported } from './osrmClient';
import { isOnline } from '../regions/connectivityService';
import { Platform } from 'react-native';
import { decodePolyline, encodePolyline } from '../../utils/polyline';
import type {
  ValhallaRoute,
  ValhallaManeuver,
  ManeuverType,
  CostingModel,
  LaneDirection,
  LaneGuidance,
} from '../../models/route';

let initialized = false;

/** Native path of the currently loaded graph, or null when none is loaded. */
let initializedPath: string | null = null;

/**
 * Routing tiers, in the order they are attempted.
 *
 * 1. `on-device` — the bundled Valhalla engine over a downloaded region graph.
 * 2. `osrm` — the (online) OSRM server, when Valhalla cannot answer.
 * 3. `mapkit` / `fossgis` — Apple MapKit `MKDirections` and the public
 *    FOSSGIS Valhalla instances, both network-backed last resorts.
 */
export type RoutingTier = 'on-device' | 'osrm' | 'mapkit' | 'fossgis';

/** Terminal state when every tier failed (nothing was computed). */
export type RoutingTierStatus = RoutingTier | 'unavailable';

export interface RoutingTierState {
  /** Tier that produced the most recent successful route. */
  tier: RoutingTierStatus;
  /** Epoch ms of that computation. */
  at: number;
  /** True whenever the answer did not come from the on-device engine. */
  degraded: boolean;
}

/**
 * Last tier used to compute a route. Kept as a tiny observable (not a Zustand
 * store) because routing is a service-level concern shared by the map, the
 * navigation screen and CarPlay — none of which own this state.
 */
let tierState: RoutingTierState | null = null;
const tierListeners = new Set<() => void>();

export function getRoutingTierState(): RoutingTierState | null {
  return tierState;
}

/** Stable snapshot for `useSyncExternalStore` (object identity only changes
 *  when the tier actually changes). */
export function subscribeRoutingTier(listener: () => void): () => void {
  tierListeners.add(listener);
  return () => {
    tierListeners.delete(listener);
  };
}

function recordRoutingTier(tier: RoutingTierStatus): void {
  tierState = { tier, at: Date.now(), degraded: tier !== 'on-device' };
  for (const listener of tierListeners) listener();
}

/** Reset for tests and for a full routing dispose. */
export function resetRoutingTier(): void {
  tierState = null;
  for (const listener of tierListeners) listener();
}

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

/** Extract the interchange sign text from one Valhalla maneuver `sign` list. */
function signListText(sign: Record<string, unknown>, key: string): string | undefined {
  const elements = sign[key];
  if (!Array.isArray(elements)) return undefined;
  const text = elements
    .map((el) => {
      const raw = (el as Record<string, unknown>)?.['text'];
      return typeof raw === 'string' ? raw.trim() : '';
    })
    .filter(Boolean)
    .join(' / ');
  return text || undefined;
}

/** Parse the interchange exit info from a Valhalla maneuver's `sign` object. */
function parseExitSign(
  sign: Record<string, unknown> | undefined,
): Pick<ValhallaManeuver, 'exitNumber' | 'exitBranch' | 'exitName' | 'exitToward'> {
  if (!sign) return {};
  return {
    exitNumber: signListText(sign, 'exit_number_elements'),
    exitBranch: signListText(sign, 'exit_branch_elements'),
    exitName: signListText(sign, 'exit_name_elements'),
    exitToward: signListText(sign, 'exit_toward_elements'),
  };
}

/** Valhalla turn-lane direction bitmask values (see Valhalla API docs). */
const LANE_BIT_THROUGH = 2;
const LANE_BIT_SHARP_LEFT = 4;
const LANE_BIT_LEFT = 8;
const LANE_BIT_SLIGHT_LEFT = 16;
const LANE_BIT_SLIGHT_RIGHT = 32;
const LANE_BIT_RIGHT = 64;
const LANE_BIT_SHARP_RIGHT = 128;
const LANE_BIT_REVERSE = 256;
const LANE_BIT_MERGE_LEFT = 512;
const LANE_BIT_MERGE_RIGHT = 1024;

/** Map a single Valhalla lane bit to a display direction. */
function laneBitToDirection(bit: number): LaneDirection | null {
  switch (bit) {
    case LANE_BIT_LEFT:
    case LANE_BIT_SHARP_LEFT:
      return 'left';
    case LANE_BIT_SLIGHT_LEFT:
      return 'slight_left';
    case LANE_BIT_THROUGH:
      return 'straight';
    case LANE_BIT_SLIGHT_RIGHT:
      return 'slight_right';
    case LANE_BIT_RIGHT:
    case LANE_BIT_SHARP_RIGHT:
      return 'right';
    case LANE_BIT_MERGE_LEFT:
      return 'merge_left';
    case LANE_BIT_MERGE_RIGHT:
      return 'merge_right';
    case LANE_BIT_REVERSE:
      return 'u_turn';
    default:
      return null;
  }
}

/** Bit priority when a lane allows several directions and no single one stands out. */
const LANE_BIT_PRIORITY = [
  LANE_BIT_THROUGH,
  LANE_BIT_SLIGHT_LEFT,
  LANE_BIT_SLIGHT_RIGHT,
  LANE_BIT_LEFT,
  LANE_BIT_RIGHT,
  LANE_BIT_SHARP_LEFT,
  LANE_BIT_SHARP_RIGHT,
  LANE_BIT_MERGE_LEFT,
  LANE_BIT_MERGE_RIGHT,
  LANE_BIT_REVERSE,
];

/** First display direction for the set bits in `mask`, following `priority`. */
function pickDirectionFromMask(mask: number, priority: number[]): LaneDirection {
  for (const bit of priority) {
    if (mask & bit) {
      const dir = laneBitToDirection(bit);
      if (dir) return dir;
    }
  }
  return 'straight';
}

/** Normalize one raw lane entry to direction/active/valid bitmasks. */
function normalizeLaneMasks(lane: Record<string, unknown>): {
  mask: number;
  activeMask: number | null;
  validMask: number | null;
} {
  let mask = 0;
  const rawDirections = lane['directions'];
  if (typeof rawDirections === 'number' && Number.isFinite(rawDirections)) {
    mask = rawDirections;
  } else if (typeof rawDirections === 'string') {
    mask = maskForDirectionString(rawDirections);
  } else if (Array.isArray(rawDirections)) {
    for (const d of rawDirections) {
      if (typeof d === 'string') mask |= maskForDirectionString(d);
      else if (typeof d === 'number' && Number.isFinite(d)) mask |= d;
    }
  } else if (typeof lane['direction'] === 'string') {
    // Legacy single-string shape.
    return {
      mask: maskForDirectionString(lane['direction']),
      activeMask: lane['active'] === true ? maskForDirectionString(lane['direction']) : null,
      validMask: null,
    };
  }

  const toMask = (v: unknown): number | null => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (v === true) return mask;
    return null;
  };
  return { mask, activeMask: toMask(lane['active']), validMask: toMask(lane['valid']) };
}

/** Bitmask for one direction string (handles 'slight left' and 'slight_left'). */
function maskForDirectionString(direction: string): number {
  switch (direction.replace(/ /g, '_')) {
    case 'through':
    case 'straight':
    case 'none':
      return LANE_BIT_THROUGH;
    case 'sharp_left':
    case 'left':
      return direction.includes('sharp') ? LANE_BIT_SHARP_LEFT : LANE_BIT_LEFT;
    case 'slight_left':
      return LANE_BIT_SLIGHT_LEFT;
    case 'slight_right':
      return LANE_BIT_SLIGHT_RIGHT;
    case 'sharp_right':
    case 'right':
      return direction.includes('sharp') ? LANE_BIT_SHARP_RIGHT : LANE_BIT_RIGHT;
    case 'reverse':
      return LANE_BIT_REVERSE;
    case 'merge_left':
      return LANE_BIT_MERGE_LEFT;
    case 'merge_right':
      return LANE_BIT_MERGE_RIGHT;
    default:
      return 0;
  }
}

/**
 * Parse Valhalla lane data into our LaneGuidance format.
 *
 * Expects `turn_lanes: true` in the route request. Each lane carries a
 * `directions` bitmask of possible turns plus optional `active`/`valid`
 * bitmasks marking the lanes to follow for the maneuver (`active` = best,
 * `valid` = usable). `maneuverType` only breaks ties for multi-direction
 * lanes with no active/valid hint.
 */
export function parseLaneGuidance(
  lanes: Array<Record<string, unknown>> | undefined,
  maneuverType?: ManeuverType,
): LaneGuidance | undefined {
  if (!lanes || lanes.length === 0) return undefined;

  const normalized = lanes.map(normalizeLaneMasks);
  const hasActive = normalized.some((l) => (l.activeMask ?? 0) !== 0);
  const useValidFallback = !hasActive && normalized.some((l) => (l.validMask ?? 0) !== 0);

  const sideBias: number[] =
    maneuverType === 'turn_left' ||
    maneuverType === 'sharp_left' ||
    maneuverType === 'slight_left' ||
    maneuverType === 'merge_left' ||
    maneuverType === 'u_turn'
      ? [
          LANE_BIT_LEFT,
          LANE_BIT_SHARP_LEFT,
          LANE_BIT_SLIGHT_LEFT,
          LANE_BIT_THROUGH,
          LANE_BIT_SLIGHT_RIGHT,
          LANE_BIT_RIGHT,
          LANE_BIT_SHARP_RIGHT,
          LANE_BIT_MERGE_LEFT,
          LANE_BIT_MERGE_RIGHT,
          LANE_BIT_REVERSE,
        ]
      : maneuverType === 'turn_right' ||
          maneuverType === 'sharp_right' ||
          maneuverType === 'slight_right' ||
          maneuverType === 'merge_right' ||
          maneuverType === 'exit_highway' ||
          maneuverType === 'enter_highway'
        ? [
            LANE_BIT_RIGHT,
            LANE_BIT_SHARP_RIGHT,
            LANE_BIT_SLIGHT_RIGHT,
            LANE_BIT_THROUGH,
            LANE_BIT_SLIGHT_LEFT,
            LANE_BIT_LEFT,
            LANE_BIT_SHARP_LEFT,
            LANE_BIT_MERGE_RIGHT,
            LANE_BIT_MERGE_LEFT,
            LANE_BIT_REVERSE,
          ]
        : LANE_BIT_PRIORITY;

  const activeLanes: number[] = [];
  const laneDirections: LaneDirection[] = normalized.map((l, i) => {
    const highlightMask = hasActive ? (l.activeMask ?? 0) : (l.validMask ?? 0);
    if (useValidFallback || hasActive) {
      if (highlightMask !== 0) activeLanes.push(i);
    }
    // Display the maneuver-relevant direction when there is exactly one
    // active/valid bit; otherwise fall back to the lane's own directions.
    const singleActive = singleBit(highlightMask);
    if (singleActive) return laneBitToDirection(singleActive) ?? 'straight';
    const singleDirection = singleBit(l.mask);
    if (singleDirection) return laneBitToDirection(singleDirection) ?? 'straight';
    if (l.mask === 0) return 'straight';
    return pickDirectionFromMask(l.mask, sideBias);
  });

  return {
    laneCount: lanes.length,
    activeLanes,
    laneDirections,
  };
}

/** Return `mask` when exactly one known lane bit is set, else null. */
function singleBit(mask: number): number | null {
  const known =
    LANE_BIT_THROUGH |
    LANE_BIT_SHARP_LEFT |
    LANE_BIT_LEFT |
    LANE_BIT_SLIGHT_LEFT |
    LANE_BIT_SLIGHT_RIGHT |
    LANE_BIT_RIGHT |
    LANE_BIT_SHARP_RIGHT |
    LANE_BIT_REVERSE |
    LANE_BIT_MERGE_LEFT |
    LANE_BIT_MERGE_RIGHT;
  const bits = mask & known;
  return bits !== 0 && (bits & (bits - 1)) === 0 ? bits : null;
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

/** Combine per-leg Valhalla shapes into a single route geometry.
 *  Consecutive legs share their via-point, so the duplicated joint is
 *  dropped. Returns the combined points plus each leg's offset into them
 *  (leg shape indices are relative to their own leg). */
function combineLegShapes(shapes: string[]): {
  geometry: string;
  offsets: number[];
} {
  const legPoints = shapes.map((s) => decodePolyline(s));
  const offsets: number[] = [];
  let acc = 0;
  for (const pts of legPoints) {
    offsets.push(acc);
    if (pts.length > 0) acc += pts.length - 1;
  }
  const combined: [number, number][] = [];
  for (const pts of legPoints) {
    if (pts.length === 0) continue;
    combined.push(...pts.slice(combined.length > 0 ? 1 : 0));
  }
  return {
    geometry: combined.length > 0 ? encodePolyline(combined) : (shapes[0] ?? ''),
    offsets,
  };
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
    /** GPS course at the origin (degrees). Sent as Valhalla `heading` so the
     *  engine doesn't route you into an immediate U-turn. Omit when unknown. */
    originHeading?: number;
  },
): Promise<ValhallaRoute[]> {
  const body = {
    locations: waypoints.map((w, i) =>
      i === 0 && options?.originHeading != null
        ? {
            lat: w.lat,
            lon: w.lng,
            type: 'break',
            heading: options.originHeading,
            heading_tolerance: 60,
          }
        : { lat: w.lat, lon: w.lng, type: 'break' },
    ),
    costing,
    alternates: options?.alternates ?? 0,
    // Lane-level guidance for highway exits and merges (parsed per maneuver).
    turn_lanes: true,
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
    // Each leg carries its own shape with shape indices relative to that
    // leg. Stitch them into one geometry (dropping duplicated via-points)
    // and offset maneuver indices into the combined shape — otherwise
    // multi-stop routes only track/render the first leg.
    const legShapes = rawLegs.map((leg) =>
      typeof leg['shape'] === 'string' ? (leg['shape'] as string) : '',
    );
    const singleLeg = rawLegs.length <= 1;
    const combined = singleLeg
      ? { geometry: legShapes[0] ?? '', offsets: [0] }
      : combineLegShapes(legShapes);
    const legs = rawLegs.map((leg, legIdx) => ({
      maneuvers: ((leg['maneuvers'] ?? []) as Record<string, unknown>[]).map(
        (m): ValhallaManeuver => {
          const type = valhallaTypeCode((m['type'] as number) ?? 0);
          const offset = combined.offsets[legIdx] ?? 0;
          return {
            type,
            instruction: (m['instruction'] as string) ?? '',
            distanceMeters: ((m['length'] as number) ?? 0) * 1000,
            durationSeconds: (m['time'] as number) ?? 0,
            beginShapeIndex: ((m['begin_shape_index'] as number) ?? 0) + offset,
            endShapeIndex: ((m['end_shape_index'] as number) ?? 0) + offset,
            streetNames: m['street_names'] as string[] | undefined,
            verbalPreTransition: (m['verbal_pre_transition_instruction'] as string) ?? '',
            verbalPostTransition: m['verbal_post_transition_instruction'] as string | undefined,
            ...parseExitSign(m['sign'] as Record<string, unknown> | undefined),
            // Not rounded: see routeMapping.ts — rounding to whole mph here
            // corrupts the km/h value the sign shows metric users.
            speedLimitMph:
              typeof m['speed_limit'] === 'number'
                ? (m['speed_limit'] as number) * 0.621371 // km/h → mph
                : undefined,
            laneGuidance: parseLaneGuidance(
              m['lanes'] as Array<Record<string, unknown>> | undefined,
              type,
            ),
          };
        },
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
      geometry: singleLeg ? firstLegShape : combined.geometry,
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
  // The native bridge builds the URL with `URL(fileURLWithPath:)`, which needs
  // a raw path — a `file://` prefix would resolve into a bogus directory.
  const nativePath = graphTilePath.replace(/^file:\/\//, '');
  await Valhalla.initialize({ graphTilePath: nativePath });
  initialized = true;
  initializedPath = nativePath;
}

/** Returns true if a local routing graph has been successfully loaded. */
export function isRoutingInitialized(): boolean {
  return initialized;
}

/** Native path of the loaded graph, or null when none is loaded. */
export function getInitializedPath(): string | null {
  return initializedPath;
}

/** Options shared by the whole cascade. `originHeading` is only honoured by
 *  the network tiers: the bundled Valhalla build cannot take a start bearing. */
type RouteCascadeOptions = {
  avoidTolls?: boolean;
  avoidHighways?: boolean;
  avoidFerries?: boolean;
  alternates?: number;
  originHeading?: number;
};

interface CascadeContext {
  /** Present for a reroute: enables the native single-destination fast path and
   *  the MapKit reroute shape (both take a bearing). */
  reroute?: {
    currentPosition: { lat: number; lng: number; bearing: number };
    destination: { lat: number; lng: number };
  };
}

function describeFailure(err: unknown): string {
  if (err instanceof Error) return err.name === 'AbortError' ? 'timed out' : err.message;
  return String(err);
}

/**
 * Run the routing cascade in tier order and return the first tier that answers.
 *
 * 1. on-device Valhalla
 * 2. OSRM
 * 3. MapKit `MKDirections`, then the FOSSGIS public Valhalla instances
 *
 * Every tier failure is absorbed so a degraded network cannot turn one slow
 * endpoint into a dead navigation session; only "all tiers failed" throws.
 */
async function runRouteCascade(
  waypoints: Array<{ lat: number; lng: number }>,
  costing: CostingModel,
  options?: RouteCascadeOptions,
  ctx: CascadeContext = {},
): Promise<ValhallaRoute[]> {
  const failures: string[] = [];

  // ── Tier 1 — on-device Valhalla ──────────────────────────────────────────
  if (initialized) {
    try {
      const routes =
        ctx.reroute && waypoints.length === 2
          ? [await Valhalla.reroute(ctx.reroute.currentPosition, ctx.reroute.destination, costing)]
          : await Valhalla.computeRoute(waypoints, costing, {
              avoidTolls: options?.avoidTolls,
              avoidHighways: options?.avoidHighways,
              avoidFerries: options?.avoidFerries,
              alternates: options?.alternates,
            });
      if (routes.length > 0) {
        recordRoutingTier('on-device');
        return routes;
      }
      failures.push('on-device Valhalla: no route in coverage');
    } catch (err) {
      failures.push(`on-device Valhalla: ${describeFailure(err)}`);
    }
  } else {
    failures.push('on-device Valhalla: no region graph loaded');
  }

  // ── Tier 2 — OSRM ────────────────────────────────────────────────────────
  if (!isOnline()) {
    failures.push('OSRM: offline');
  } else if (!isOsrmSupported(costing)) {
    failures.push(`OSRM: no "${costing}" profile`);
  } else {
    try {
      const routes = await computeOsrmRoute(waypoints, costing, {
        alternates: options?.alternates,
        originHeading: options?.originHeading,
      });
      if (routes.length > 0) {
        recordRoutingTier('osrm');
        return routes;
      }
      failures.push('OSRM: no route');
    } catch (err) {
      failures.push(`OSRM: ${describeFailure(err)}`);
    }
  }

  // ── Tier 3 — Apple MapKit, then FOSSGIS public Valhalla ──────────────────
  if (Platform.OS === 'ios' && MapKitRouting.isMapKitAvailable()) {
    try {
      const routes = ctx.reroute
        ? [
            await mapKitRerouteOrCompute(
              waypoints,
              ctx.reroute.currentPosition,
              ctx.reroute.destination,
              costing,
            ),
          ]
        : await MapKitRouting.computeRoute(waypoints, costing);
      if (routes.length > 0) {
        recordRoutingTier('mapkit');
        return routes;
      }
      failures.push('MapKit: no route');
    } catch (err) {
      failures.push(`MapKit: ${describeFailure(err)}`);
    }
  } else if (Platform.OS !== 'ios') {
    failures.push('MapKit: iOS only');
  }

  if (isOnline()) {
    try {
      const routes = await computeRouteOnline(waypoints, costing, options);
      if (routes.length > 0) {
        recordRoutingTier('fossgis');
        return routes;
      }
      failures.push('FOSSGIS Valhalla: no route');
    } catch (err) {
      failures.push(`FOSSGIS Valhalla: ${describeFailure(err)}`);
    }
  } else {
    failures.push('FOSSGIS Valhalla: offline');
  }

  recordRoutingTier('unavailable');
  if (!initialized && !isOnline()) {
    throw new Error('No offline routing data and no internet connection.');
  }
  throw new Error(`Every routing tier failed.\n${failures.join('\n')}`);
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
  return runRouteCascade(waypoints, costing, options);
}

export interface RerouteOptions {
  /** Intermediate stops that must be preserved (origin → via… → destination).
   *  The native fast-path reroute only supports a single destination, so when
   *  via-points are present the multi-waypoint compute path is used instead. */
  via?: Array<{ lat: number; lng: number }>;
  avoidTolls?: boolean;
  avoidHighways?: boolean;
  avoidFerries?: boolean;
  /** GPS course at the deviation point (degrees). Forwarded as Valhalla
   *  `heading` on the online request so the engine routes forward instead
   *  of demanding an immediate U-turn. Omit when unknown/stationary. */
  heading?: number;
}

async function mapKitRerouteOrCompute(
  waypoints: Array<{ lat: number; lng: number }>,
  currentPosition: { lat: number; lng: number; bearing: number },
  destination: { lat: number; lng: number },
  costing: CostingModel,
): Promise<ValhallaRoute> {
  if (Platform.OS === 'ios' && MapKitRouting.isMapKitAvailable()) {
    if (waypoints.length > 2) {
      const routes = await MapKitRouting.computeRoute(waypoints, costing);
      if (!routes.length) throw new Error('No route found');
      return routes[0];
    }
    return await MapKitRouting.reroute(currentPosition, destination, costing);
  }
  throw new Error('MapKit routing is not available on this platform');
}

export async function reroute(
  currentPosition: { lat: number; lng: number; bearing: number },
  destination: { lat: number; lng: number },
  costing: CostingModel,
  options?: RerouteOptions,
): Promise<ValhallaRoute> {
  const via = options?.via ?? [];
  const waypoints = [{ lat: currentPosition.lat, lng: currentPosition.lng }, ...via, destination];

  // Same tier order as a fresh route: on-device first, then OSRM, then the
  // network-backed last resorts. `heading` only reaches the network tiers —
  // the bundled Valhalla build cannot take a start bearing — so an on-device
  // reroute may still pick the wrong direction at a stop; the next fix is
  // normally enough to snap back.
  const routes = await runRouteCascade(
    waypoints,
    costing,
    {
      avoidTolls: options?.avoidTolls,
      avoidHighways: options?.avoidHighways,
      avoidFerries: options?.avoidFerries,
      originHeading: options?.heading,
    },
    { reroute: { currentPosition, destination } },
  );

  if (!routes.length) throw new Error('No route found');
  return routes[0];
}

/**
 * Compute candidate reroutes from the current position, returning the primary
 * plus any engine alternatives. The faster-route monitor compares these against
 * the active route. Alternatives are requested from whichever tier answers;
 * MapKit returns a single route, so a tier-3 reroute degrades to one candidate.
 */
export async function rerouteCandidates(
  currentPosition: { lat: number; lng: number; bearing: number },
  destination: { lat: number; lng: number },
  costing: CostingModel,
  options?: RerouteOptions & { alternates?: number },
): Promise<ValhallaRoute[]> {
  const via = options?.via ?? [];
  const alternates = options?.alternates ?? 0;

  const routes = await runRouteCascade(
    [{ lat: currentPosition.lat, lng: currentPosition.lng }, ...via, destination],
    costing,
    {
      avoidTolls: options?.avoidTolls,
      avoidHighways: options?.avoidHighways,
      avoidFerries: options?.avoidFerries,
      originHeading: options?.heading,
      // Valhalla does not combine alternates with via points; OSRM does.
      alternates: via.length === 0 ? alternates : 0,
    },
    { reroute: { currentPosition, destination } },
  );

  if (!routes.length) throw new Error('No route found');
  return routes;
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
  initializedPath = null;
}
