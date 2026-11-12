/**
 * Reverse-geocoding query shape.
 *
 * Kept out of `geocodingService` so the SQL and the tier policy can be executed
 * against a real SQLite database in tests — the service itself pulls in
 * `expo-sqlite`, which every unit test mocks.
 *
 * The index this relies on (`geocoding_rtree`) is created by
 * `database/init.ts`; `geocoding_data` is written by region-pack imports and can
 * hold hundreds of thousands of rows per metro once interpolated house numbers
 * are expanded.
 */

/** Radius used when a caller does not specify one (kilometres). */
export const DEFAULT_RADIUS_KM = 0.5;

/** Whether a tier looks at street addresses or at every other named feature. */
export type ReversePredicate = 'address' | 'other';

export interface ReverseTier {
  /** Which rows this tier is allowed to answer with. */
  readonly predicate: ReversePredicate;
  /** Search radius for this tier, in kilometres. */
  readonly radiusKm: number;
}

/**
 * Tiers, most specific first.
 *
 * A single 500 m query returns nothing whenever no row sits inside it — a rural
 * pin, a pack with sparse address coverage, the middle of a park. "Nothing" is
 * exactly what used to push the UI onto a network geocoder, so each tier widens
 * the net while keeping the most specific answer first.
 *
 * `radiusKm` scales the first two tiers; the wider ones derive from it, so a
 * caller asking for a tight search still gets a bounded cascade rather than a
 * continental one.
 */
export function reverseTiers(radiusKm: number = DEFAULT_RADIUS_KM): ReverseTier[] {
  const base = radiusKm > 0 ? radiusKm : DEFAULT_RADIUS_KM;
  return [
    // The address next to the pin.
    { predicate: 'address', radiusKm: base },
    // A named feature next to it is still a useful answer ("Boston Common").
    { predicate: 'other', radiusKm: base },
    // Nearby addresses when the block itself is unmapped.
    { predicate: 'address', radiusKm: base * 20 },
    // Nearest named place — a locality or POI — at region scale.
    { predicate: 'other', radiusKm: Math.max(base * 200, 100) },
  ];
}

export interface SearchWindow {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/** Bounding box for a radius, with the polar cosine clamped. */
export function searchWindow(lat: number, lng: number, radiusKm: number): SearchWindow {
  const latDelta = radiusKm / 111;
  // Clamped so a polar query cannot invert the box and silently degrade into a
  // full scan.
  const lngScale = Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  const lngDelta = radiusKm / (111 * lngScale);
  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLng: lng - lngDelta,
    maxLng: lng + lngDelta,
  };
}

/**
 * Longitude weight for distance ordering: cos²(lat), so a degree of longitude
 * counts for what it is actually worth here. Exact metres are not needed to
 * pick the nearest row inside a kilometre-scale box, and this keeps the whole
 * lookup to one index scan.
 */
export function longitudeWeight(lat: number): number {
  const scale = Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  return scale * scale;
}

/**
 * Nearest row inside the window, via the R*Tree.
 *
 * The R*Tree holds 32-bit floats (~0.5 m at mid latitudes), so it only narrows
 * candidates; the ordering below is computed against the real columns.
 */
export function reverseQuerySql(predicate: ReversePredicate): string {
  const typeClause = predicate === 'address' ? 'g.type = ?' : 'g.type <> ?';
  return `SELECT g.id, g.text, g.type, g.housenumber, g.street, g.city, g.state, g.postcode,
       g.country, g.lat, g.lng
  FROM geocoding_rtree r
  JOIN geocoding_data g ON g.id = r.id
 WHERE r.max_lat >= ? AND r.min_lat <= ?
   AND r.max_lng >= ? AND r.min_lng <= ?
   AND ${typeClause}
 ORDER BY ((g.lat - ?) * (g.lat - ?)) + ((g.lng - ?) * (g.lng - ?) * ?) ASC
 LIMIT 1`;
}

/** Bind values matching {@link reverseQuerySql}. */
export function reverseQueryParams(
  lat: number,
  lng: number,
  window: SearchWindow,
  lngWeight: number,
): (number | string)[] {
  return [
    window.minLat,
    window.maxLat,
    window.minLng,
    window.maxLng,
    'address',
    lat,
    lat,
    lng,
    lng,
    lngWeight,
  ];
}
