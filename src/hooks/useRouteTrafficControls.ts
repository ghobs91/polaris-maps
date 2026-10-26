/**
 * Stop signs and traffic lights along the route ahead, for the navigation map.
 *
 * The visible map during navigation only covers a few kilometres, so querying
 * the whole trip would be wasted work. The hook walks the route from the live
 * position, keeps the next few kilometres, and re-fetches when the vehicle has
 * moved far enough that a new slice matters. Per-cell caching in
 * `mapillaryTrafficControls` means most re-fetches cost nothing.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  controlsNearPath,
  fetchTrafficControlsAlongRoute,
  type TrafficControl,
} from '../services/imagery/mapillaryTrafficControls';
import { decodePolyline } from '../utils/polyline';
import { haversineMeters } from '../utils/routeSnap';

/** How far ahead of the driver icons are fetched. */
const LOOKAHEAD_METERS = 4_000;
/** Re-fetch after the vehicle has advanced this far. */
const REFETCH_BUCKET_METERS = 500;
/** Keep only controls this close to the driven line. */
const CORRIDOR_METERS = 35;
/** Hard cap on markers so a dense urban block cannot overwhelm the map. */
const MAX_ICONS = 30;

interface Corridor {
  coords: [number, number][];
  key: string;
}

/** Cheap route fingerprint so switching routes cannot reuse stale markers. */
function routeSignature(encoded: string): number {
  let hash = 0;
  for (let index = 0; index < encoded.length; index += 8) {
    hash = (hash * 31 + encoded.charCodeAt(index)) | 0;
  }
  return hash;
}

function nearestRouteIndex(
  coords: ReadonlyArray<[number, number]>,
  position: [number, number],
): number {
  let bestIndex = 0;
  let bestDistance = Infinity;
  for (let index = 0; index < coords.length; index++) {
    const distance = haversineMeters(position, coords[index]);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function distanceAlongMeters(coords: ReadonlyArray<[number, number]>, endIndex: number): number {
  let total = 0;
  for (let index = 1; index <= endIndex && index < coords.length; index++) {
    total += haversineMeters(coords[index - 1], coords[index]);
  }
  return total;
}

function sliceAhead(
  coords: ReadonlyArray<[number, number]>,
  startIndex: number,
  maxMeters: number,
): [number, number][] {
  if (coords.length === 0) return [];
  const slice: [number, number][] = [[coords[startIndex][0], coords[startIndex][1]]];
  let total = 0;
  for (let index = startIndex + 1; index < coords.length; index++) {
    total += haversineMeters(coords[index - 1], coords[index]);
    slice.push([coords[index][0], coords[index][1]]);
    if (total >= maxMeters) break;
  }
  return slice;
}

export function useRouteTrafficControls(
  geometry: string | undefined,
  position: [number, number] | null | undefined,
  enabled: boolean,
): TrafficControl[] {
  const [controls, setControls] = useState<TrafficControl[]>([]);

  const routeCoords = useMemo(() => (geometry ? decodePolyline(geometry) : []), [geometry]);
  const routeKey = useMemo(() => (geometry ? routeSignature(geometry) : 0), [geometry]);

  const corridor = useMemo<Corridor | null>(() => {
    if (!enabled || routeCoords.length === 0) return null;
    const startIndex = position ? nearestRouteIndex(routeCoords, position) : 0;
    const bucket = Math.floor(distanceAlongMeters(routeCoords, startIndex) / REFETCH_BUCKET_METERS);
    return {
      coords: sliceAhead(routeCoords, startIndex, LOOKAHEAD_METERS),
      // The bucket only moves every 500 m, so the effect does not refetch on
      // every GPS fix.
      key: `${routeKey}:${bucket}`,
    };
  }, [enabled, routeCoords, routeKey, position]);

  const corridorRef = useRef(corridor);
  corridorRef.current = corridor;
  const corridorKey = corridor?.key ?? '';

  useEffect(() => {
    if (!enabled || !corridorKey) {
      setControls([]);
      return;
    }

    let cancelled = false;
    const coords = corridorRef.current?.coords ?? [];

    fetchTrafficControlsAlongRoute(coords).then((all) => {
      if (cancelled) return;
      const onRoute = controlsNearPath(all, coords, CORRIDOR_METERS);
      const origin = coords[0];
      const nearestFirst = origin
        ? [...onRoute].sort(
            (a, b) =>
              haversineMeters([a.lng, a.lat], origin) - haversineMeters([b.lng, b.lat], origin),
          )
        : onRoute;
      setControls(nearestFirst.slice(0, MAX_ICONS));
    });

    return () => {
      cancelled = true;
    };
  }, [enabled, corridorKey]);

  return controls;
}
