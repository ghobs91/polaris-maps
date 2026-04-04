/**
 * Fetches Amtrak route geometry from the BTS (Bureau of Transportation
 * Statistics) ArcGIS FeatureServer.
 *
 * Source: https://geodata.bts.gov/datasets/usdot::amtrak-routes/about
 * Data: FRA (Federal Railroad Administration), 1:24,000 scale, 49 named routes.
 *
 * The API supports spatial intersection queries so we only fetch routes
 * that pass through the current viewport, with geometry simplified via
 * `maxAllowableOffset` to keep payloads under ~200 KB.
 */

import type { TransitRouteLine } from '../../models/transit';

const BTS_AMTRAK_ROUTES =
  'https://services.arcgis.com/xOi1kZaI0eWDREZv/arcgis/rest/services/NTAD_Amtrak_Routes/FeatureServer/0/query';

/** Amtrak's brand blue. */
const AMTRAK_COLOR = '1A4B8D';

/** Simplification tolerance in degrees (~110 m). Keeps curves while cutting payload. */
const MAX_OFFSET = 0.001;

/** Client-side timeout (ms). */
const FETCH_TIMEOUT_MS = 15_000;

/** Cache: once fetched for a viewport, don't re-fetch. */
let cachedLines: TransitRouteLine[] | null = null;

interface BtsFeature {
  properties: { name: string };
  geometry: {
    type: string;
    coordinates: number[][] | number[][][];
  };
}

interface BtsGeoJson {
  features: BtsFeature[];
}

/**
 * Fetch Amtrak routes that intersect the given bounding box.
 * Returns TransitRouteLines with real curved track geometry.
 *
 * Results are cached after the first successful fetch.
 */
export async function fetchAmtrakRoutes(
  minLat: number,
  minLng: number,
  maxLat: number,
  maxLng: number,
): Promise<TransitRouteLine[]> {
  if (cachedLines) return cachedLines;

  const params = new URLSearchParams({
    where: '1=1',
    outFields: 'NAME',
    geometry: `${minLng},${minLat},${maxLng},${maxLat}`,
    geometryType: 'esriGeometryEnvelope',
    spatialRel: 'esriSpatialRelIntersects',
    f: 'geojson',
    outSR: '4326',
    geometryPrecision: '5',
    maxAllowableOffset: String(MAX_OFFSET),
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(`${BTS_AMTRAK_ROUTES}?${params}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return [];

    const data: BtsGeoJson = await res.json();
    const lines: TransitRouteLine[] = [];

    for (const feat of data.features) {
      const name = feat.properties.name;
      const geom = feat.geometry;
      if (!geom) continue;

      // Convert to [lng, lat][][] segments
      let segments: [number, number][][];
      if (geom.type === 'MultiLineString') {
        segments = (geom.coordinates as number[][][]).map((seg) =>
          seg.map(([lng, lat]) => [lng, lat] as [number, number]),
        );
      } else if (geom.type === 'LineString') {
        segments = [
          (geom.coordinates as number[][]).map(([lng, lat]) => [lng, lat] as [number, number]),
        ];
      } else {
        continue;
      }

      if (segments.length === 0) continue;

      lines.push({
        id: `bts:amtrak:${name.toLowerCase().replace(/\s+/g, '-')}`,
        ref: undefined,
        name,
        operator: 'Amtrak',
        color: AMTRAK_COLOR,
        mode: 'RAIL',
        geometry: segments,
        stops: [],
      });
    }

    if (lines.length > 0) {
      cachedLines = lines;
    }
    return lines;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** Exposed for testing. */
export function clearAmtrakCache(): void {
  cachedLines = null;
}
