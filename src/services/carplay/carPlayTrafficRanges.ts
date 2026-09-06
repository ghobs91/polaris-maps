import type { NormalizedTrafficSegment } from '../../models/traffic';
import { buildRouteTrafficGeoJSON, DEFAULT_ROUTE_COLOR } from '../traffic/routeTrafficService';
import { decodePolyline } from '../../utils/polyline';

export interface CarPlayTrafficRange {
  /** Hex color (`#RRGGBB`) for the segment core. */
  color: string;
  /** Inclusive shape-point indices into the route's decoded polyline. */
  from: number;
  to: number;
}

/**
 * Convert traffic-colored route runs into compact index ranges for CarPlay.
 *
 * The native side decodes the same precision-6 polyline, so shape indices
 * align 1:1 and only `{color, from, to}` triples cross the bridge — never
 * full coordinate arrays.
 *
 * Returns `null` when there is nothing worth sending: no traffic data, or a
 * single default-blue run (the native map already draws the blue fallback).
 */
export function buildCarPlayTrafficRanges(
  geometry: string,
  segments: NormalizedTrafficSegment[],
): CarPlayTrafficRange[] | null {
  const coords = decodePolyline(geometry);
  if (coords.length < 2 || segments.length === 0) return null;

  const geojson = buildRouteTrafficGeoJSON(coords, segments);
  const { features } = geojson;
  if (features.length === 0) return null;
  if (features.length === 1 && features[0].properties.color === DEFAULT_ROUTE_COLOR) {
    return null;
  }

  // Runs partition the route's pairs contiguously and share endpoints, so a
  // cursor over the decoded shape points maps each run to indices.
  const ranges: CarPlayTrafficRange[] = [];
  let cursor = 0;
  for (const feature of features) {
    const count = feature.geometry.coordinates.length;
    if (count < 2) continue;
    ranges.push({
      color: feature.properties.color,
      from: cursor,
      to: cursor + count - 1,
    });
    cursor += count - 1;
  }
  return ranges.length > 0 ? ranges : null;
}

/** Stable signature for change-detection so identical data isn't re-sent. */
export function trafficRangesSignature(ranges: CarPlayTrafficRange[] | null): string {
  if (!ranges) return '';
  return ranges.map((r) => `${r.color}:${r.from}-${r.to}`).join(';');
}
