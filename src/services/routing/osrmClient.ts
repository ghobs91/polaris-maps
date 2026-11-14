/**
 * OSRM routing client — tier 2 of the routing cascade.
 *
 * Runs only when the on-device Valhalla engine cannot answer (no region graph
 * loaded, route outside tile coverage, engine error). OSRM has no transit
 * profile and no live-traffic costing, so it is deliberately narrower than
 * Valhalla: it exists to keep turn-by-turn working when the local graph cannot.
 *
 * The response is normalised into the app's `ValhallaRoute` shape so every
 * downstream consumer (route snap, manoeuvre feed, lane strip, traffic ETA)
 * stays engine-agnostic.
 */

import { OSRM_BASE_URL } from '../../constants/config';
import { decodePolyline, encodePolyline } from '../../utils/polyline';
import type {
  CostingModel,
  ManeuverType,
  ValhallaManeuver,
  ValhallaRoute,
} from '../../models/route';

/** Per-request budget. A slow OSRM must not stall the cascade before the
 *  tier-3 fallbacks get their turn. */
const OSRM_TIMEOUT_MS = 8_000;

/** OSRM has no transit costing; the tier is skipped for that mode. */
export function isOsrmSupported(costing: CostingModel): boolean {
  return costing !== 'transit';
}

function profileFor(costing: CostingModel): string | null {
  switch (costing) {
    case 'auto':
      return 'driving';
    case 'pedestrian':
      return 'walking';
    case 'bicycle':
      return 'cycling';
    default:
      return null;
  }
}

interface OsrmManeuver {
  type?: string;
  modifier?: string;
  exit?: number;
  bearing_after?: number;
  location?: [number, number];
}

interface OsrmIntersection {
  classes?: string[];
}

interface OsrmStep {
  distance?: number;
  duration?: number;
  geometry?: string;
  name?: string;
  ref?: string;
  exits?: string;
  maneuver?: OsrmManeuver;
  intersections?: OsrmIntersection[];
}

interface OsrmLeg {
  distance?: number;
  duration?: number;
  steps?: OsrmStep[];
}

interface OsrmRoute {
  distance?: number;
  duration?: number;
  legs?: OsrmLeg[];
  bbox?: [number, number, number, number];
  geometry?: string;
}

interface OsrmResponse {
  code?: string;
  message?: string;
  routes?: OsrmRoute[];
}

/** OSRM modifier → app manoeuvre type. */
function modifierToType(modifier: string | undefined): ManeuverType {
  switch (modifier) {
    case 'uturn':
      return 'u_turn';
    case 'sharp right':
      return 'sharp_right';
    case 'right':
      return 'turn_right';
    case 'slight right':
      return 'slight_right';
    case 'sharp left':
      return 'sharp_left';
    case 'left':
      return 'turn_left';
    case 'slight left':
      return 'slight_left';
    default:
      return 'continue';
  }
}

function stepClasses(step: OsrmStep): string[] {
  const out: string[] = [];
  for (const intersection of step.intersections ?? []) {
    for (const cls of intersection.classes ?? []) out.push(cls);
  }
  return out;
}

function mapManeuverType(step: OsrmStep): ManeuverType {
  const type = step.maneuver?.type ?? '';
  const modifier = step.maneuver?.modifier;
  const classes = stepClasses(step);

  if (classes.includes('ferry')) return 'ferry';

  switch (type) {
    case 'depart':
      return 'start';
    case 'arrive':
    case 'arrive left':
    case 'arrive right':
      return 'destination';
    case 'merge':
      return modifier?.includes('left') ? 'merge_left' : 'merge_right';
    case 'on ramp':
    case 'off ramp':
      return type === 'on ramp' ? 'enter_highway' : 'exit_highway';
    case 'roundabout':
    case 'rotary':
    case 'roundabout turn':
    case 'exit roundabout':
    case 'exit rotary':
      return 'enter_roundabout';
    case 'new name':
      return 'name_change';
    case 'fork':
    case 'end of road':
    case 'continue':
    case 'use lane':
    case 'turn':
    default:
      return modifierToType(modifier);
  }
}

/** OSRM returns structured steps but no prose. Build a short instruction that
 *  reads the same way as the Valhalla ones the navigation UI already renders. */
function buildInstruction(step: OsrmStep, type: ManeuverType): string {
  const road = step.name?.trim() || step.ref?.trim() || '';
  const onto = road ? ` onto ${road}` : '';

  switch (type) {
    case 'start':
      return road ? `Start on ${road}` : 'Start';
    case 'destination':
      return 'Arrive at your destination';
    case 'continue':
      return road ? `Continue on ${road}` : 'Continue';
    case 'name_change':
      return road ? `Continue onto ${road}` : 'Continue';
    case 'u_turn':
      return `Make a U-turn${onto}`;
    case 'turn_left':
      return `Turn left${onto}`;
    case 'turn_right':
      return `Turn right${onto}`;
    case 'sharp_left':
      return `Make a sharp left${onto}`;
    case 'sharp_right':
      return `Make a sharp right${onto}`;
    case 'slight_left':
      return `Bear left${onto}`;
    case 'slight_right':
      return `Bear right${onto}`;
    case 'merge_left':
      return `Merge left${onto}`;
    case 'merge_right':
      return `Merge right${onto}`;
    case 'enter_highway':
      return `Take the ramp${onto}`;
    case 'exit_highway':
      return `Take the exit${onto}`;
    case 'enter_roundabout': {
      const exit = step.maneuver?.exit;
      const which = typeof exit === 'number' ? ` and take exit ${exit}` : '';
      return `Enter the roundabout${which}${onto}`;
    }
    case 'ferry':
      return road ? `Take the ferry to ${road}` : 'Take the ferry';
    default:
      return road ? `Continue on ${road}` : 'Continue';
  }
}

/** Append a decoded step geometry, returning the step's begin/end indices in
 *  the accumulated path.
 *
 *  Consecutive OSRM steps share their joint point, and `arrive` steps repeat a
 *  single point; both are stored once so the indices stay consistent with the
 *  geometry route snapping walks. */
function appendPath(
  path: [number, number][],
  piece: [number, number][],
): { start: number; end: number } {
  if (path.length === 0 && piece.length === 0) return { start: 0, end: 0 };
  const last = path[path.length - 1];
  const sharesJoint =
    !!last && piece.length > 0 && last[0] === piece[0][0] && last[1] === piece[0][1];
  const start = path.length === 0 ? 0 : sharesJoint ? path.length - 1 : path.length;

  for (const point of piece) {
    const previous = path[path.length - 1];
    if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) {
      path.push(point);
    }
  }
  return { start, end: Math.max(0, path.length - 1) };
}

function boundingBoxFor(path: [number, number][]): [number, number, number, number] {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of path) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  if (!Number.isFinite(minLng)) return [0, 0, 0, 0];
  return [minLng, minLat, maxLng, maxLat];
}

function normalizeRoute(route: OsrmRoute): ValhallaRoute {
  const path: [number, number][] = [];
  let hasToll = false;
  let hasFerry = false;

  const legs = (route.legs ?? []).map((leg) => {
    let legDistance = 0;
    let legDuration = 0;

    const maneuvers = (leg.steps ?? []).map((step): ValhallaManeuver => {
      const decoded = step.geometry ? decodePolyline(step.geometry, 6) : [];
      const { start: beginShapeIndex, end: endShapeIndex } = appendPath(path, decoded);

      const type = mapManeuverType(step);
      const classes = stepClasses(step);
      if (classes.includes('toll')) hasToll = true;
      if (classes.includes('ferry')) hasFerry = true;

      const distanceMeters = step.distance ?? 0;
      const durationSeconds = step.duration ?? 0;
      legDistance += distanceMeters;
      legDuration += durationSeconds;

      const instruction = buildInstruction(step, type);
      return {
        type,
        instruction,
        distanceMeters,
        durationSeconds,
        beginShapeIndex,
        endShapeIndex,
        streetNames: step.name ? [step.name] : undefined,
        verbalPreTransition: instruction,
      };
    });

    return {
      maneuvers,
      distanceMeters: leg.distance ?? legDistance,
      durationSeconds: leg.duration ?? legDuration,
    };
  });

  const summaryDistance = route.distance ?? legs.reduce((sum, l) => sum + l.distanceMeters, 0);
  const summaryDuration = route.duration ?? legs.reduce((sum, l) => sum + l.durationSeconds, 0);

  return {
    summary: {
      distanceMeters: summaryDistance,
      durationSeconds: summaryDuration,
      hasToll,
      hasFerry,
    },
    legs,
    geometry: path.length > 0 ? encodePolyline(path) : (route.geometry ?? ''),
    boundingBox: route.bbox ?? boundingBoxFor(path),
  };
}

export interface OsrmRouteOptions {
  avoidTolls?: boolean;
  avoidHighways?: boolean;
  avoidFerries?: boolean;
  alternates?: number;
  /** GPS course at the origin (degrees). Sent as OSRM `bearings` so the route
   *  leaves in the direction of travel instead of demanding a U-turn. */
  originHeading?: number;
}

/**
 * Compute a route through the configured OSRM server.
 *
 * Throws when OSRM is unreachable, rejects the request, or returns no route —
 * the caller treats any throw as "tier failed" and moves on.
 */
export async function computeOsrmRoute(
  waypoints: Array<{ lat: number; lng: number }>,
  costing: CostingModel,
  options?: OsrmRouteOptions,
): Promise<ValhallaRoute[]> {
  const profile = profileFor(costing);
  if (!profile) throw new Error(`OSRM does not support the "${costing}" costing model`);
  if (waypoints.length < 2) throw new Error('OSRM routing needs at least two waypoints');

  const coordinates = waypoints.map((w) => `${w.lng},${w.lat}`).join(';');
  const params = new URLSearchParams({
    overview: 'false',
    geometries: 'polyline6',
    steps: 'true',
    annotations: 'false',
    alternatives: String(Math.max(0, options?.alternates ?? 0)),
  });

  // OSRM's avoid flags are profile features (`exclude=`), not generic options;
  // they are silently unavailable on the demo profile, so they are not sent.
  if (options?.originHeading != null && Number.isFinite(options.originHeading)) {
    const heading = Math.round(((options.originHeading % 360) + 360) % 360);
    params.set('bearings', waypoints.map((_, i) => (i === 0 ? `${heading},60` : '')).join(';'));
  }

  const url = `${OSRM_BASE_URL.replace(/\/+$/, '')}/route/v1/${profile}/${coordinates}?${params.toString()}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OSRM_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OSRM error ${res.status}: ${body.slice(0, 200)}`);
  }

  const json = (await res.json()) as OsrmResponse;
  if (json.code !== 'Ok' || !json.routes?.length) {
    throw new Error(`OSRM returned no route${json.message ? `: ${json.message}` : ''}`);
  }

  return json.routes.map(normalizeRoute);
}
