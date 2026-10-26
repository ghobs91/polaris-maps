/**
 * "Big hassle" turn detection and route preference.
 *
 * A hassle turn is a real intersection turn with no traffic light and no stop
 * sign managing the crossing. The data for that judgement comes from Mapillary:
 * detections are only trustworthy where Mapillary has street-level imagery, so
 * a turn on an uncovered road is never treated as a hassle — we simply do not
 * know, and penalising it would avoid perfectly good intersections.
 *
 * `preferTurnManagedRoute` evaluates the alternative routes Valhalla already
 * returns and promotes the one whose turns are better managed. It never picks a
 * route more than a few minutes slower than the fastest, and returns the input
 * untouched when Mapillary is not configured, the request fails, or no safer
 * candidate exists. It does not add a routing-engine-specific avoidance request,
 * so it works identically for online Valhalla, the native offline engine, and
 * the MapKit fallback.
 */

import type {
  CostingModel,
  ManeuverType,
  ValhallaManeuver,
  ValhallaRoute,
} from '../../models/route';
import { decodePolyline } from '../../utils/polyline';
import { haversineMeters } from '../../utils/routeSnap';
import {
  getTrafficControlStateAt,
  isTrafficControlDataAvailable,
  TRAFFIC_CONTROL_MATCH_RADIUS_METERS,
  type TrafficControlState,
} from '../imagery/mapillaryTrafficControls';

/**
 * Maneuvers that cross or enter another road. Roundabouts, merges, highway
 * ramps and name changes are excluded: they have their own flow control
 * (yield-on-entry, ramp geometry) and are not the "unprotected turn" this
 * feature is about.
 */
const TURN_MANEUVER_TYPES: ReadonlySet<ManeuverType> = new Set<ManeuverType>([
  'turn_left',
  'turn_right',
  'sharp_left',
  'sharp_right',
  'slight_left',
  'slight_right',
  'u_turn',
]);

/** A control within this distance of the turn point manages that turn. */
export const HASSLE_TURN_RADIUS_METERS = TRAFFIC_CONTROL_MATCH_RADIUS_METERS;

/** Cost added per unmanaged turn when ranking candidates. */
export const HASSLE_TURN_PENALTY_SECONDS = 90;

/** Never promote a route that adds more than this much time... */
const MAX_EXTRA_DETOUR_SECONDS = 300;
/** ...or is more than this much slower than the fastest candidate. */
const MAX_EXTRA_DETOUR_RATIO = 1.25;

/** How many turns per route are evaluated (bounds Mapillary requests). */
const MAX_TURNS_PER_ROUTE = 12;

/** Total time budget for the whole preference pass. */
const TURN_PREFERENCE_BUDGET_MS = 2_500;

export interface TurnAssessment {
  maneuver: ValhallaManeuver;
  hasCoverage: boolean;
  hasTrafficControl: boolean;
  /** True only when coverage exists and no control was found. */
  hassle: boolean;
}

export function isTurnManeuver(maneuver: Pick<ValhallaManeuver, 'type'>): boolean {
  return TURN_MANEUVER_TYPES.has(maneuver.type);
}

/** Any stop sign or traffic light within `radius` of the state's point. */
export function hasTrafficControlWithin(
  state: TrafficControlState,
  radiusMeters = HASSLE_TURN_RADIUS_METERS,
): boolean {
  return state.controls.some(
    (control) =>
      haversineMeters([control.lng, control.lat], [state.lng, state.lat]) <= radiusMeters,
  );
}

/**
 * Classify one maneuver.
 *
 * `state` is null when the Mapillary lookup failed; that is treated as unknown,
 * not as "uncontrolled".
 */
export function assessTurn(
  maneuver: ValhallaManeuver,
  state: TrafficControlState | null,
  radiusMeters = HASSLE_TURN_RADIUS_METERS,
): TurnAssessment {
  if (!isTurnManeuver(maneuver) || !state || !state.hasCoverage) {
    return {
      maneuver,
      hasCoverage: state?.hasCoverage ?? false,
      hasTrafficControl: state ? hasTrafficControlWithin(state, radiusMeters) : false,
      hassle: false,
    };
  }

  const controlled = hasTrafficControlWithin(state, radiusMeters);
  return {
    maneuver,
    hasCoverage: true,
    hasTrafficControl: controlled,
    hassle: !controlled,
  };
}

export function hassleTurnCount(assessments: readonly TurnAssessment[]): number {
  return assessments.reduce((count, assessment) => count + (assessment.hassle ? 1 : 0), 0);
}

/** Raw route duration plus the per-hassle-turn penalty. */
export function routePreferenceScore(
  route: ValhallaRoute,
  assessments: readonly TurnAssessment[],
): number {
  return route.summary.durationSeconds + hassleTurnCount(assessments) * HASSLE_TURN_PENALTY_SECONDS;
}

/** Guard against trading a large detour for a marginally calmer route. */
export function isAcceptableDetour(durationSeconds: number, fastestSeconds: number): boolean {
  if (!Number.isFinite(durationSeconds)) return false;
  return (
    durationSeconds - fastestSeconds <= MAX_EXTRA_DETOUR_SECONDS &&
    durationSeconds <= fastestSeconds * MAX_EXTRA_DETOUR_RATIO
  );
}

/**
 * Index of the preferred candidate, or 0 when nothing beats the fastest.
 * Ties keep the earliest candidate, which is Valhalla's own preference.
 */
export function choosePreferredRouteIndex(
  routes: readonly ValhallaRoute[],
  assessments: ReadonlyArray<readonly TurnAssessment[]>,
): number {
  if (routes.length === 0) return -1;
  const fastest = Math.min(...routes.map((route) => route.summary.durationSeconds));

  let bestIndex = 0;
  let bestScore = Infinity;
  for (let index = 0; index < routes.length; index++) {
    const route = routes[index];
    if (!isAcceptableDetour(route.summary.durationSeconds, fastest)) continue;
    const score = routePreferenceScore(route, assessments[index] ?? []);
    if (score < bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }
  return bestIndex;
}

async function assessRoute(route: ValhallaRoute): Promise<TurnAssessment[]> {
  const coords = decodePolyline(route.geometry);
  if (coords.length === 0) return [];

  const turns = route.legs
    .flatMap((leg) => leg.maneuvers)
    .filter(isTurnManeuver)
    .slice(0, MAX_TURNS_PER_ROUTE);

  return Promise.all(
    turns.map(async (maneuver) => {
      const shapeIndex = Math.min(Math.max(maneuver.beginShapeIndex, 0), coords.length - 1);
      const [lng, lat] = coords[shapeIndex];
      const state = await getTrafficControlStateAt(lat, lng);
      return assessTurn(maneuver, state);
    }),
  );
}

/** Resolve with null instead of waiting past `ms` (or on rejection). */
function withBudget<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

/**
 * Rank candidates with the hassle-turn penalty, returning a new array whose
 * first item is the preferred route. The input order is preserved when nothing
 * better is found. Car routes only.
 */
export async function preferTurnManagedRoute(
  routes: readonly ValhallaRoute[],
  costing: CostingModel,
): Promise<ValhallaRoute[]> {
  if (costing !== 'auto' || routes.length < 2 || !isTrafficControlDataAvailable()) {
    return [...routes];
  }

  const assessed = await withBudget(
    Promise.all(routes.map((route) => assessRoute(route))),
    TURN_PREFERENCE_BUDGET_MS,
  );
  if (!assessed) return [...routes];

  const preferredIndex = choosePreferredRouteIndex(routes, assessed);
  if (preferredIndex <= 0) return [...routes];

  return [routes[preferredIndex], ...routes.filter((_, index) => index !== preferredIndex)];
}
