import type { ValhallaRoute } from '../models/route';

export interface RouteStop {
  lat: number;
  lng: number;
  name?: string;
}

export interface UpcomingStop {
  /** Index into the active-navigation waypoints array; -1 for the final destination. */
  waypointIndex: number;
  name: string;
  isDestination: boolean;
  /** Cumulative seconds from now until arrival. */
  etaSeconds: number;
}

function legDuration(route: ValhallaRoute | null, legIndex: number): number {
  return route?.legs[legIndex]?.durationSeconds ?? 0;
}

/**
 * Builds the list shown in the expanded navigation HUD: every pending stop
 * followed by the final destination, each with a cumulative ETA.
 *
 * The active route's legs line up with [origin, ...waypoints, destination],
 * so the time to reach waypoints[i] is the sum of legs from currentLegIndex
 * through i, and the destination adds the final leg.
 */
export function buildUpcomingStops(
  route: ValhallaRoute | null,
  waypoints: RouteStop[],
  currentLegIndex: number,
  destination: { name?: string } | null,
): UpcomingStop[] {
  const stops: UpcomingStop[] = [];
  const start = Math.max(0, Math.min(currentLegIndex, waypoints.length));
  let cumulativeSeconds = 0;

  for (let i = start; i < waypoints.length; i++) {
    cumulativeSeconds += legDuration(route, i);
    stops.push({
      waypointIndex: i,
      name: waypoints[i].name ?? `Stop ${i + 1}`,
      isDestination: false,
      etaSeconds: cumulativeSeconds,
    });
  }

  cumulativeSeconds += legDuration(route, waypoints.length);
  stops.push({
    waypointIndex: -1,
    name: destination?.name ?? 'Destination',
    isDestination: true,
    etaSeconds: cumulativeSeconds,
  });

  return stops;
}

/** Removes the stop at `index` from a pending-stops list. */
export function removeStop<T>(stops: T[], index: number): T[] {
  return stops.filter((_, i) => i !== index);
}

/**
 * Moves the stop at `index` one position earlier (-1) or later (+1).
 * Returns the same array reference when the move would fall out of bounds.
 */
export function moveStop<T>(stops: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (index < 0 || index >= stops.length || target < 0 || target >= stops.length) {
    return stops;
  }
  const next = [...stops];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
