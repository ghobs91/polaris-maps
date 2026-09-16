import { projectRouteDistance } from './congestionAhead';
import type { TrafficIncident } from '../../models/traffic';

export interface IncidentsAheadOptions {
  /** Only incidents this many metres ahead of the vehicle are returned. */
  lookaheadMeters?: number;
}

const DEFAULT_LOOKAHEAD_METERS = 5_000;

/**
 * Return unexpired incidents positioned ahead on the active route within the
 * look-ahead window, nearest first. Incidents behind the vehicle or beyond
 * the window are excluded.
 */
export function findIncidentsAhead(
  routeCoords: ReadonlyArray<[number, number]>,
  currentPosition: [number, number],
  incidents: ReadonlyArray<TrafficIncident>,
  options: IncidentsAheadOptions = {},
): TrafficIncident[] {
  const lookaheadMeters = options.lookaheadMeters ?? DEFAULT_LOOKAHEAD_METERS;
  if (routeCoords.length < 2 || incidents.length === 0) return [];

  const currentRouteDistance = projectRouteDistance(routeCoords, currentPosition);
  const now = Date.now();

  return incidents
    .filter((incident) => incident.expiresAt > now)
    .map((incident) => ({
      incident,
      routeDistance: projectRouteDistance(routeCoords, [incident.lng, incident.lat]),
    }))
    .filter(
      (entry) =>
        entry.routeDistance > currentRouteDistance &&
        entry.routeDistance - currentRouteDistance <= lookaheadMeters,
    )
    .sort((a, b) => a.routeDistance - b.routeDistance)
    .map((entry) => entry.incident);
}
