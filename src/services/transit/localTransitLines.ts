/**
 * Transit route lines answered from a region pack.
 *
 * The transit layer used to have exactly one way to get route geometry: ask a
 * live source. For most of Europe that meant downloading a consolidated
 * national GTFS zip — 495 MiB for Germany, 209 MiB for Switzerland, 159 MiB for
 * the Netherlands — and buffering all of it before parsing. On a phone that is
 * a termination, and on the origin it is a volunteer host absorbing hundreds of
 * terabytes.
 *
 * A downloaded pack already carries the same lines: `osm_transit_routes` holds
 * the route relation's mode, ref, colour and full geometry, with a stop→route
 * join beside it. So for a covered area this module answers the layer with zero
 * network calls, and the national feed is never requested.
 *
 * `fetchLocalTransitLines` returns `null` — not `[]` — when no pack covers the
 * box, so an uncovered area falls through to the live sources rather than
 * rendering an empty map.
 */

import {
  hasLocalTransitCoverage,
  queryTransitRoutesInBounds,
  queryTransitStopsByIds,
  type TransitBounds,
} from './localTransitIndex';
import type { TransitMode, TransitRouteLine } from '../../models/transit';

/** Most route relations to materialise for one viewport. */
const DEFAULT_LINE_LIMIT = 500;

/** Local mode strings are already `TransitMode`; anything else renders as rail. */
function toTransitMode(mode: string): TransitMode {
  switch (mode) {
    case 'BUS':
    case 'RAIL':
    case 'SUBWAY':
    case 'TRAM':
    case 'FERRY':
      return mode;
    default:
      return 'RAIL';
  }
}

/**
 * Route lines for a viewport, or `null` when no pack covers it.
 *
 * Geometry is stored `[[lat, lng], ...]` and rendered as a single segment in
 * `[lng, lat]` order — the pack holds one polyline per route relation, so there
 * is nothing to split into segments.
 */
export async function fetchLocalTransitLines(
  bounds: TransitBounds,
  limit: number = DEFAULT_LINE_LIMIT,
): Promise<TransitRouteLine[] | null> {
  try {
    if (!(await hasLocalTransitCoverage(bounds))) return null;

    const routes = await queryTransitRoutesInBounds(bounds, limit);
    if (routes.length === 0) {
      // Covered but empty is a real answer: this pack indexed the area and has
      // no routes in it. Returning [] stops the caller from downloading a
      // national feed to rediscover that.
      return [];
    }

    const stopIds = [...new Set(routes.flatMap((route) => route.stopIds))];
    const stops = await queryTransitStopsByIds(stopIds).catch(
      () => new Map<number, { osmId: number; name: string; lat: number; lng: number }>(),
    );

    return routes.map((route) => {
      const geometry: [number, number][] = route.geometry.map(([lat, lng]) => [lng, lat]);
      return {
        id: `osm:route:${route.osmId}`,
        ref: route.ref,
        name: route.name,
        color: route.colour,
        mode: toTransitMode(route.mode),
        geometry: geometry.length >= 2 ? [geometry] : [],
        stops: route.stopIds.flatMap((id) => {
          const stop = stops.get(id);
          return stop
            ? [{ name: stop.name, lat: stop.lat, lon: stop.lng, stopId: `osm:node:${id}` }]
            : [];
        }),
      } satisfies TransitRouteLine;
    });
  } catch {
    // Any index failure must leave the live sources untouched.
    return null;
  }
}
