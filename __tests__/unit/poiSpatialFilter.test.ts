import { filterPoisForDisplay, ViewportBounds } from '../../src/utils/poiSpatialFilter';
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

/** Generate `count` POIs spread evenly across the viewport bounds. */
function generatePois(count: number, bounds = NYC_BOUNDS): OsmPoi[] {
  const pois: OsmPoi[] = [];
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  for (let r = 0; r < rows && pois.length < count; r++) {
    for (let c = 0; c < cols && pois.length < count; c++) {
      const lat = bounds.minLat + ((bounds.maxLat - bounds.minLat) * r) / rows;
      const lng = bounds.minLng + ((bounds.maxLng - bounds.minLng) * c) / cols;
      const subtypes = ['restaurant', 'cafe', 'pharmacy', 'bank', 'supermarket'];
      pois.push(makePoi(`POI ${pois.length}`, lat, lng, subtypes[pois.length % subtypes.length]));
    }
  }
  return pois;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  idCounter = 1;
});

describe('filterPoisForDisplay', () => {
  it('returns empty array for empty input', () => {
    expect(filterPoisForDisplay([], NYC_BOUNDS, 15)).toEqual([]);
  });

  it('permits more POIs at higher zoom levels', () => {
    const pois = generatePois(300);

    const atZoom14 = filterPoisForDisplay(pois, NYC_BOUNDS, 14);
    const atZoom17 = filterPoisForDisplay(pois, NYC_BOUNDS, 17);

    // At zoom 17, the max cap is 300 and exclusion zones are smaller,
    // so significantly more POIs should be visible.
    expect(atZoom17.length).toBeGreaterThan(atZoom14.length);
  });

  it('caps at 180 for zoom 14', () => {
    const pois = generatePois(300);
    const result = filterPoisForDisplay(pois, NYC_BOUNDS, 14);
    expect(result.length).toBeLessThanOrEqual(180);
  });

  it('caps at 100 for low zoom levels (< 14)', () => {
    const pois = generatePois(200);
    const result = filterPoisForDisplay(pois, NYC_BOUNDS, 13);
    expect(result.length).toBeLessThanOrEqual(100);
  });

  it('allows up to 500 POIs at street-level zoom', () => {
    // Generate a large set of well-spaced POIs across a wider area
    const wideBounds: ViewportBounds = {
      minLat: 40.7,
      minLng: -74.02,
      maxLat: 40.8,
      maxLng: -73.92,
    };
    const pois = generatePois(700, wideBounds);
    const result = filterPoisForDisplay(pois, wideBounds, 18);
    // Should be able to display well over 100 at street level
    expect(result.length).toBeGreaterThan(100);
    expect(result.length).toBeLessThanOrEqual(500);
  });

  it('maintains category diversity via round-robin', () => {
    // 5 restaurants and 5 cafes, all at different locations
    const pois: OsmPoi[] = [];
    for (let i = 0; i < 5; i++) {
      pois.push(makePoi(`Rest ${i}`, 40.74 + i * 0.003, -73.99, 'restaurant'));
      pois.push(makePoi(`Cafe ${i}`, 40.74 + i * 0.003, -73.98, 'cafe'));
    }

    const result = filterPoisForDisplay(pois, NYC_BOUNDS, 16);

    const restaurants = result.filter((p) => p.subtype === 'restaurant');
    const cafes = result.filter((p) => p.subtype === 'cafe');

    // Both categories should be represented
    expect(restaurants.length).toBeGreaterThan(0);
    expect(cafes.length).toBeGreaterThan(0);
  });
});
