/**
 * Which pack-backed region to offer a new user.
 *
 * The onboarding gate used to show only the Geofabrik tree — states and
 * countries, none of which have a pack. Those download as individual tiles from
 * OpenFreeMap, which caps offline downloads at 50 MB, so a large state like New
 * York failed every time. The packs have no such cap; they just were not on the
 * screen.
 *
 * This picks the pack to offer: the smallest one containing the user, else the
 * nearest, else the first (so a location-less launch still shows something
 * downloadable rather than nothing).
 *
 * Only regions with a manifest qualify. Offering one without assets would send
 * the user straight back to the capped tile path.
 */

import type { Region } from '../../models/region';

/** Regions that can actually be downloaded as a pack. */
export function packRegions(regions: readonly Region[]): Region[] {
  return regions.filter((region) => (region.assets?.length ?? 0) > 0);
}

function contains(region: Region, lat: number, lng: number): boolean {
  const { minLat, maxLat, minLng, maxLng } = region.bounds;
  return lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng;
}

/** Area in square degrees — only used to rank, so an approximation is fine. */
function area(region: Region): number {
  const { minLat, maxLat, minLng, maxLng } = region.bounds;
  return Math.abs(maxLat - minLat) * Math.abs(maxLng - minLng);
}

/** Squared distance from the point to the region's centre, in degrees. */
function distanceToCentreSq(region: Region, lat: number, lng: number): number {
  const { minLat, maxLat, minLng, maxLng } = region.bounds;
  const dLat = (minLat + maxLat) / 2 - lat;
  // Longitude degrees shrink towards the poles; scale so the ranking is fair.
  const dLng = ((minLng + maxLng) / 2 - lng) * Math.cos((lat * Math.PI) / 180);
  return dLat * dLat + dLng * dLng;
}

/**
 * The pack to offer for a location.
 *
 * Returns `null` only when there are no pack-backed regions at all.
 */
export function pickNearestPackRegion(
  regions: readonly Region[],
  lat?: number | null,
  lng?: number | null,
): Region | null {
  const packs = packRegions(regions);
  if (packs.length === 0) return null;

  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    // No location: still offer something, deterministically.
    return [...packs].sort((a, b) => a.name.localeCompare(b.name))[0] ?? null;
  }

  const containing = packs.filter((region) => contains(region, lat, lng));
  if (containing.length > 0) {
    // Smallest wins: the metro pack rather than a state that contains it.
    return containing.reduce((best, region) => (area(region) < area(best) ? region : best));
  }

  return packs.reduce((best, region) =>
    distanceToCentreSq(region, lat, lng) < distanceToCentreSq(best, lat, lng) ? region : best,
  );
}
