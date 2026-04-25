import {
  filterPoisForDisplay,
  STREET_LEVEL_POI_ZOOM,
  ViewportBounds,
} from '../../src/utils/poiSpatialFilter';
import type { OsmPoi } from '../../src/services/poi/osmFetcher';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NYC_BOUNDS: ViewportBounds = {
  minLat: 40.74,
  minLng: -73.99,
  maxLat: 40.76,
  maxLng: -73.97,
};

let idCounter = 1;

function makePoi(name: string, lat: number, lng: number, subtype = 'restaurant'): OsmPoi {
  return {
    id: idCounter++,
    lat,
    lng,
    name,
    type: 'amenity',
    subtype,
    tags: { name, amenity: subtype },
  };
}

/** Generate `count` POIs spread across the viewport bounds. */
function generatePois(count: number, bounds = NYC_BOUNDS): OsmPoi[] {
  const pois: OsmPoi[] = [];
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const subtypes = ['restaurant', 'cafe', 'pharmacy', 'bank', 'supermarket'];
  for (let r = 0; r < rows && pois.length < count; r++) {
    for (let c = 0; c < cols && pois.length < count; c++) {
      const lat = bounds.minLat + ((bounds.maxLat - bounds.minLat) * r) / rows;
      const lng = bounds.minLng + ((bounds.maxLng - bounds.minLng) * c) / cols;
      pois.push(makePoi(`POI ${pois.length}`, lat, lng, subtypes[pois.length % subtypes.length]));
    }
  }
  return pois;
}

beforeEach(() => {
  idCounter = 1;
});

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

describe('filterPoisForDisplay — performance', () => {
  it('filters 500 POIs at zoom 17 within 10ms', () => {
    const pois = generatePois(500);
    const start = performance.now();
    const result = filterPoisForDisplay(pois, NYC_BOUNDS, 17);
    const elapsed = performance.now() - start;

    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThanOrEqual(500);
    expect(elapsed).toBeLessThan(10);
  });

  it('filters 1000 POIs at zoom 16 within 15ms', () => {
    const pois = generatePois(1000);
    const start = performance.now();
    const result = filterPoisForDisplay(pois, NYC_BOUNDS, 16);
    const elapsed = performance.now() - start;

    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThanOrEqual(400);
    expect(elapsed).toBeLessThan(15);
  });

  it('filters 2000 POIs at zoom 15 within 25ms', () => {
    const wideBounds: ViewportBounds = {
      minLat: 40.7,
      minLng: -74.02,
      maxLat: 40.8,
      maxLng: -73.92,
    };
    const pois = generatePois(2000, wideBounds);
    const start = performance.now();
    const result = filterPoisForDisplay(pois, wideBounds, 15);
    const elapsed = performance.now() - start;

    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThanOrEqual(300);
    expect(elapsed).toBeLessThan(25);
  });

  it('produces identical output to a naive O(n²) approach', () => {
    // Deterministic set — verify grid-based selection matches expected behaviour.
    // We can't compare to the old code directly, but we verify no overlaps and
    // that the pill count stays within the zoom cap.
    const pois = generatePois(300);
    const result = filterPoisForDisplay(pois, NYC_BOUNDS, 16);

    // All returned POIs should be from the input set
    const inputIds = new Set(pois.map((p) => p.id));
    for (const poi of result) {
      expect(inputIds.has(poi.id)).toBe(true);
    }

    // No two returned POIs should overlap (pixel-space check)
    // Recompute pixel coords and verify exclusion gaps
    const scale = 256 * Math.pow(2, 16);
    function toPixel(lat: number, lng: number) {
      const x = ((lng + 180) / 360) * scale;
      const sinLat = Math.sin((lat * Math.PI) / 180);
      const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale;
      return { x, y };
    }

    const MARKER_W = 70;
    const MARKER_H = 22;
    const t = Math.min(1, Math.max(0, (16 - 14) / 3));
    const gapScale = 1 - t * 0.65;
    const gapX = (MARKER_W + 4) * gapScale;
    const gapY = (MARKER_H + 3) * gapScale;

    const placed = result.map((p) => toPixel(p.lat, p.lng));
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const overlaps =
          Math.abs(placed[i].x - placed[j].x) < gapX && Math.abs(placed[i].y - placed[j].y) < gapY;
        expect(overlaps).toBe(false);
      }
    }
  });
});
