/**
 * POI address assembly and fuzzy matching for external rating lookup.
 *
 * Ratings are identified by place name plus an address or `geo` confirmation.
 * OSM `addr:*` tags are the primary address source; the MapKit enriched
 * formatted address is a fallback.
 */

import type { GeoPoint } from './externalRatings/types';

/** Assemble a single-line address from OSM tags, enriched formatted address, or both. */
export function assemblePoiAddress(
  tags: Record<string, string> | undefined,
  formattedAddress?: string | null,
): string | null {
  const t = tags ?? {};
  const parts: string[] = [];
  const num = t['addr:housenumber'];
  const street = t['addr:street'];
  if (num && street) parts.push(`${num} ${street}`);
  else if (street) parts.push(street);
  const tail = [t['addr:city'], t['addr:state'], t['addr:postcode']].filter(Boolean).join(' ');
  if (tail) parts.push(tail);
  if (parts.length) return parts.join(', ');

  const full = t['addr:full'] ?? t['address'];
  if (full) return full;
  const formatted = formattedAddress?.trim();
  return formatted ? formatted : null;
}

/** Lowercase, strip punctuation, collapse whitespace. */
export function normalizeAddress(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function leadingNumber(value: string): string | null {
  const token = normalizeAddress(value).split(' ')[0] ?? '';
  return /^\d+[a-z]?$/.test(token) ? token : null;
}

/**
 * Loose address match: equal after normalization, containment, or a matching
 * leading house number plus at least one shared street token (≥3 chars).
 */
export function addressesMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const na = normalizeAddress(a);
  const nb = normalizeAddress(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 6 && (na.includes(nb) || nb.includes(na))) return true;

  const numA = leadingNumber(na);
  const numB = leadingNumber(nb);
  if (!numA || numA !== numB) return false;
  const tokensA = new Set(na.split(' '));
  // Require a shared non-numeric token (street name), not just the house number.
  return nb
    .split(' ')
    .some((token) => token.length >= 3 && /[a-z]/.test(token) && tokensA.has(token));
}

const EARTH_RADIUS_M = 6_371_000;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance between two points, in meters. */
export function distanceMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** True when `point` is within `meters` of the target. */
export function withinMeters(point: GeoPoint, target: GeoPoint, meters: number): boolean {
  return distanceMeters(point, target) <= meters;
}
