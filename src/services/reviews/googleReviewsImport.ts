/**
 * Parser for Google Maps Takeout `Reviews.json`.
 *
 * The file is a GeoJSON FeatureCollection. Each feature carries the user's
 * published star rating plus optional text:
 *
 * ```json
 * {
 *   "type": "Feature",
 *   "geometry": { "type": "Point", "coordinates": [-73.61, 40.73] },
 *   "properties": {
 *     "date": "2025-01-07T23:00:13.001902Z",
 *     "five_star_rating_published": 1,
 *     "google_maps_url": "https://www.google.com/maps/place//data=...",
 *     "location": {
 *       "address": "555 Stewart Ave, Garden City, NY 11530, United States",
 *       "name": "Florent"
 *     },
 *     "review_text_published": "..."
 *   }
 * }
 * ```
 *
 * Coordinates are GeoJSON order: [longitude, latitude].
 */

export interface ParsedGoogleReview {
  /** Business name from the review (`location.name`). */
  name: string;
  /** Full address string, when present. Used only as a resolution hint. */
  address?: string;
  lat: number;
  lng: number;
  /** 1–5 star rating. */
  rating: number;
  /** Review body; may be empty when the user only left stars. */
  text?: string;
  /** Original publication time (seconds since epoch), when parseable. */
  createdAt?: number;
  googleMapsUrl?: string;
}

interface ReviewsJsonFeature {
  type?: string;
  geometry?: { type?: string; coordinates?: unknown };
  properties?: {
    date?: unknown;
    five_star_rating_published?: unknown;
    google_maps_url?: unknown;
    location?: { address?: unknown; name?: unknown };
    review_text_published?: unknown;
  };
}

function toFiniteNumber(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : (value as number);
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/** Extract [lng, lat] from a GeoJSON Point geometry. Null when invalid. */
function extractLatLng(feature: ReviewsJsonFeature): { lat: number; lng: number } | null {
  const coords = feature.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const lng = toFiniteNumber(coords[0]);
  const lat = toFiniteNumber(coords[1]);
  if (lng === null || lat === null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

function extractRating(value: unknown): number | null {
  const n = toFiniteNumber(value);
  if (n === null || !Number.isInteger(n) || n < 1 || n > 5) return null;
  return n;
}

function extractCreatedAt(value: unknown): number | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return undefined;
  return Math.floor(ms / 1000);
}

/**
 * Parse the full text of a Takeout `Reviews.json` file.
 *
 * Accepts either a FeatureCollection (`{type, features}`) or a bare array of
 * features. Entries missing a usable name, coordinates, or 1–5 rating are
 * skipped (they cannot be matched to a place or stored as a review).
 */
export function parseGoogleReviewsJson(jsonText: string): ParsedGoogleReview[] {
  let data: unknown;
  try {
    data = JSON.parse(jsonText);
  } catch {
    throw new Error('That file is not valid JSON — pick the Reviews.json from your Takeout.');
  }

  const rawFeatures: unknown[] = Array.isArray(data)
    ? data
    : (data as { features?: unknown })?.features &&
        Array.isArray((data as { features: unknown }).features)
      ? ((data as { features: unknown[] }).features as unknown[])
      : [];

  const reviews: ParsedGoogleReview[] = [];
  for (const raw of rawFeatures) {
    const feature = raw as ReviewsJsonFeature;
    const props = feature?.properties;
    if (!props) continue;

    const name = props.location?.name;
    const latLng = extractLatLng(feature);
    const rating = extractRating(props.five_star_rating_published);
    if (typeof name !== 'string' || name.trim().length === 0) continue;
    if (!latLng) continue;
    if (rating === null) continue;

    const address =
      typeof props.location?.address === 'string' && props.location.address.trim().length > 0
        ? props.location.address.trim()
        : undefined;
    const text =
      typeof props.review_text_published === 'string' &&
      props.review_text_published.trim().length > 0
        ? props.review_text_published.trim().slice(0, 2000)
        : undefined;
    const googleMapsUrl =
      typeof props.google_maps_url === 'string' && props.google_maps_url.length > 0
        ? props.google_maps_url
        : undefined;

    reviews.push({
      name: name.trim(),
      address,
      lat: latLng.lat,
      lng: latLng.lng,
      rating,
      text,
      createdAt: extractCreatedAt(props.date),
      googleMapsUrl,
    });
  }

  return reviews;
}
