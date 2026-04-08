import type { Region } from '../models/region';

/** A region entry from the bundled catalog (no runtime download-state fields). */
export type CatalogEntry = Pick<
  Region,
  'id' | 'name' | 'bounds' | 'tilesSizeBytes' | 'routingSizeBytes' | 'geocodingSizeBytes'
>;

/** Convert a catalog entry to a full Region ready to upsert + download. */
export function catalogEntryToRegion(entry: CatalogEntry): Region {
  return {
    ...entry,
    version: '1.0',
    downloadStatus: 'none',
    downloadedAt: null,
    lastUpdated: null,
    driveKey: null,
    geocodingUrl: null,
  };
}

/** Returns true if lat/lng falls within an entry's bounding box. */
export function catalogEntryContainsPoint(entry: CatalogEntry, lat: number, lng: number): boolean {
  return (
    lat >= entry.bounds.minLat &&
    lat <= entry.bounds.maxLat &&
    lng >= entry.bounds.minLng &&
    lng <= entry.bounds.maxLng
  );
}

/** Return catalog sorted nearest-first relative to the given point. */
export function sortCatalogByDistance(
  entries: CatalogEntry[],
  lat: number,
  lng: number,
): CatalogEntry[] {
  return [...entries].sort((a, b) => {
    const ac = {
      lat: (a.bounds.minLat + a.bounds.maxLat) / 2,
      lng: (a.bounds.minLng + a.bounds.maxLng) / 2,
    };
    const bc = {
      lat: (b.bounds.minLat + b.bounds.maxLat) / 2,
      lng: (b.bounds.minLng + b.bounds.maxLng) / 2,
    };
    const ad = (lat - ac.lat) ** 2 + (lng - ac.lng) ** 2;
    const bd = (lat - bc.lat) ** 2 + (lng - bc.lng) ** 2;
    return ad - bd;
  });
}

// ---------------------------------------------------------------------------
// Bundled catalog — mirrors scripts/regions.json (build-time source of truth).
// ---------------------------------------------------------------------------
export const REGION_CATALOG: CatalogEntry[] = [
  // North America
  {
    id: 'us-ny-new-york',
    name: 'New York Metro',
    bounds: { minLat: 40.4, maxLat: 41.0, minLng: -74.3, maxLng: -73.7 },
    tilesSizeBytes: 251658240,
    routingSizeBytes: 125829120,
    geocodingSizeBytes: 194035200,
  },
  {
    id: 'us-ca-los-angeles',
    name: 'Los Angeles',
    bounds: { minLat: 33.7, maxLat: 34.4, minLng: -118.7, maxLng: -117.9 },
    tilesSizeBytes: 188743680,
    routingSizeBytes: 99614720,
    geocodingSizeBytes: 136314880,
  },
  {
    id: 'us-ca-san-francisco',
    name: 'San Francisco Bay Area',
    bounds: { minLat: 37.2, maxLat: 38.0, minLng: -122.6, maxLng: -121.5 },
    tilesSizeBytes: 104857600,
    routingSizeBytes: 57671680,
    geocodingSizeBytes: 83886080,
  },
  {
    id: 'us-il-chicago',
    name: 'Chicago',
    bounds: { minLat: 41.6, maxLat: 42.1, minLng: -88.0, maxLng: -87.5 },
    tilesSizeBytes: 125829120,
    routingSizeBytes: 68157440,
    geocodingSizeBytes: 94371840,
  },
  {
    id: 'us-tx-houston',
    name: 'Houston',
    bounds: { minLat: 29.5, maxLat: 30.1, minLng: -95.6, maxLng: -95.0 },
    tilesSizeBytes: 115343360,
    routingSizeBytes: 60817408,
    geocodingSizeBytes: 78643200,
  },
  {
    id: 'us-wa-seattle',
    name: 'Seattle',
    bounds: { minLat: 47.3, maxLat: 47.8, minLng: -122.5, maxLng: -122.1 },
    tilesSizeBytes: 73400320,
    routingSizeBytes: 39845888,
    geocodingSizeBytes: 57671680,
  },
  {
    id: 'us-fl-miami',
    name: 'Miami',
    bounds: { minLat: 25.5, maxLat: 25.9, minLng: -80.5, maxLng: -80.0 },
    tilesSizeBytes: 62914560,
    routingSizeBytes: 33554432,
    geocodingSizeBytes: 47185920,
  },
  {
    id: 'us-ma-boston',
    name: 'Boston',
    bounds: { minLat: 42.2, maxLat: 42.5, minLng: -71.2, maxLng: -70.9 },
    tilesSizeBytes: 52428800,
    routingSizeBytes: 28311552,
    geocodingSizeBytes: 41943040,
  },
  {
    id: 'us-dc-washington',
    name: 'Washington, DC',
    bounds: { minLat: 38.7, maxLat: 39.1, minLng: -77.2, maxLng: -76.9 },
    tilesSizeBytes: 73400320,
    routingSizeBytes: 39845888,
    geocodingSizeBytes: 57671680,
  },
  {
    id: 'us-pa-philadelphia',
    name: 'Philadelphia',
    bounds: { minLat: 39.8, maxLat: 40.2, minLng: -75.4, maxLng: -74.9 },
    tilesSizeBytes: 73400320,
    routingSizeBytes: 39845888,
    geocodingSizeBytes: 57671680,
  },
  {
    id: 'us-ga-atlanta',
    name: 'Atlanta',
    bounds: { minLat: 33.6, maxLat: 34.0, minLng: -84.6, maxLng: -84.2 },
    tilesSizeBytes: 62914560,
    routingSizeBytes: 33554432,
    geocodingSizeBytes: 47185920,
  },
  {
    id: 'us-md-baltimore',
    name: 'Baltimore',
    bounds: { minLat: 39.1, maxLat: 39.5, minLng: -76.8, maxLng: -76.4 },
    tilesSizeBytes: 52428800,
    routingSizeBytes: 28311552,
    geocodingSizeBytes: 41943040,
  },
  {
    id: 'us-az-phoenix',
    name: 'Phoenix',
    bounds: { minLat: 33.2, maxLat: 33.8, minLng: -112.5, maxLng: -111.7 },
    tilesSizeBytes: 78643200,
    routingSizeBytes: 41943040,
    geocodingSizeBytes: 57671680,
  },
  {
    id: 'ca-on-toronto',
    name: 'Toronto',
    bounds: { minLat: 43.5, maxLat: 43.9, minLng: -79.7, maxLng: -79.1 },
    tilesSizeBytes: 94371840,
    routingSizeBytes: 50331648,
    geocodingSizeBytes: 68157440,
  },
  {
    id: 'ca-bc-vancouver',
    name: 'Vancouver',
    bounds: { minLat: 49.1, maxLat: 49.4, minLng: -123.3, maxLng: -122.9 },
    tilesSizeBytes: 62914560,
    routingSizeBytes: 33554432,
    geocodingSizeBytes: 47185920,
  },
  {
    id: 'mx-mexico-city',
    name: 'Mexico City',
    bounds: { minLat: 19.1, maxLat: 19.7, minLng: -99.4, maxLng: -98.8 },
    tilesSizeBytes: 104857600,
    routingSizeBytes: 55574528,
    geocodingSizeBytes: 73400320,
  },
  // South America
  {
    id: 'br-sao-paulo',
    name: 'São Paulo',
    bounds: { minLat: -24.0, maxLat: -23.4, minLng: -46.8, maxLng: -46.3 },
    tilesSizeBytes: 136314880,
    routingSizeBytes: 71303168,
    geocodingSizeBytes: 94371840,
  },
  {
    id: 'ar-buenos-aires',
    name: 'Buenos Aires',
    bounds: { minLat: -34.7, maxLat: -34.5, minLng: -58.6, maxLng: -58.2 },
    tilesSizeBytes: 78643200,
    routingSizeBytes: 41943040,
    geocodingSizeBytes: 57671680,
  },
  {
    id: 'co-bogota',
    name: 'Bogotá',
    bounds: { minLat: 4.5, maxLat: 4.8, minLng: -74.2, maxLng: -73.9 },
    tilesSizeBytes: 62914560,
    routingSizeBytes: 33554432,
    geocodingSizeBytes: 47185920,
  },
  // Europe
  {
    id: 'gb-england-london',
    name: 'London',
    bounds: { minLat: 51.3, maxLat: 51.7, minLng: -0.5, maxLng: 0.3 },
    tilesSizeBytes: 220200960,
    routingSizeBytes: 110100480,
    geocodingSizeBytes: 162529280,
  },
  {
    id: 'de-berlin',
    name: 'Berlin',
    bounds: { minLat: 52.3, maxLat: 52.7, minLng: 13.1, maxLng: 13.7 },
    tilesSizeBytes: 94371840,
    routingSizeBytes: 50331648,
    geocodingSizeBytes: 68157440,
  },
  {
    id: 'fr-paris',
    name: 'Paris',
    bounds: { minLat: 48.5, maxLat: 49.1, minLng: 2.0, maxLng: 3.0 },
    tilesSizeBytes: 188743680,
    routingSizeBytes: 99614720,
    geocodingSizeBytes: 136314880,
  },
  {
    id: 'es-madrid',
    name: 'Madrid',
    bounds: { minLat: 40.2, maxLat: 40.6, minLng: -3.9, maxLng: -3.5 },
    tilesSizeBytes: 78643200,
    routingSizeBytes: 41943040,
    geocodingSizeBytes: 57671680,
  },
  {
    id: 'it-rome',
    name: 'Rome',
    bounds: { minLat: 41.7, maxLat: 42.0, minLng: 12.3, maxLng: 12.6 },
    tilesSizeBytes: 73400320,
    routingSizeBytes: 39845888,
    geocodingSizeBytes: 57671680,
  },
  {
    id: 'nl-amsterdam',
    name: 'Amsterdam',
    bounds: { minLat: 52.2, maxLat: 52.5, minLng: 4.7, maxLng: 5.1 },
    tilesSizeBytes: 57671680,
    routingSizeBytes: 30408704,
    geocodingSizeBytes: 41943040,
  },
  {
    id: 'tr-istanbul',
    name: 'Istanbul',
    bounds: { minLat: 40.8, maxLat: 41.2, minLng: 28.7, maxLng: 29.3 },
    tilesSizeBytes: 104857600,
    routingSizeBytes: 55574528,
    geocodingSizeBytes: 73400320,
  },
  {
    id: 'ru-moscow',
    name: 'Moscow',
    bounds: { minLat: 55.5, maxLat: 56.0, minLng: 37.3, maxLng: 37.9 },
    tilesSizeBytes: 125829120,
    routingSizeBytes: 66060288,
    geocodingSizeBytes: 88080384,
  },
  {
    id: 'pl-warsaw',
    name: 'Warsaw',
    bounds: { minLat: 52.0, maxLat: 52.4, minLng: 20.8, maxLng: 21.3 },
    tilesSizeBytes: 57671680,
    routingSizeBytes: 30408704,
    geocodingSizeBytes: 41943040,
  },
  // Asia
  {
    id: 'jp-tokyo',
    name: 'Tokyo',
    bounds: { minLat: 35.5, maxLat: 35.9, minLng: 139.5, maxLng: 140.0 },
    tilesSizeBytes: 262144000,
    routingSizeBytes: 136314880,
    geocodingSizeBytes: 188743680,
  },
  {
    id: 'in-delhi',
    name: 'Delhi',
    bounds: { minLat: 28.4, maxLat: 28.9, minLng: 76.8, maxLng: 77.4 },
    tilesSizeBytes: 94371840,
    routingSizeBytes: 50331648,
    geocodingSizeBytes: 68157440,
  },
  {
    id: 'in-mumbai',
    name: 'Mumbai',
    bounds: { minLat: 18.9, maxLat: 19.3, minLng: 72.7, maxLng: 73.0 },
    tilesSizeBytes: 78643200,
    routingSizeBytes: 41943040,
    geocodingSizeBytes: 57671680,
  },
  {
    id: 'kr-seoul',
    name: 'Seoul',
    bounds: { minLat: 37.4, maxLat: 37.7, minLng: 126.7, maxLng: 127.2 },
    tilesSizeBytes: 125829120,
    routingSizeBytes: 66060288,
    geocodingSizeBytes: 88080384,
  },
  {
    id: 'sg-singapore',
    name: 'Singapore',
    bounds: { minLat: 1.1, maxLat: 1.5, minLng: 103.6, maxLng: 104.1 },
    tilesSizeBytes: 52428800,
    routingSizeBytes: 28311552,
    geocodingSizeBytes: 41943040,
  },
  {
    id: 'th-bangkok',
    name: 'Bangkok',
    bounds: { minLat: 13.6, maxLat: 14.0, minLng: 100.3, maxLng: 101.0 },
    tilesSizeBytes: 73400320,
    routingSizeBytes: 39845888,
    geocodingSizeBytes: 52428800,
  },
  {
    id: 'id-jakarta',
    name: 'Jakarta',
    bounds: { minLat: -6.4, maxLat: -6.1, minLng: 106.6, maxLng: 107.1 },
    tilesSizeBytes: 73400320,
    routingSizeBytes: 39845888,
    geocodingSizeBytes: 52428800,
  },
  {
    id: 'ph-manila',
    name: 'Manila',
    bounds: { minLat: 14.4, maxLat: 14.8, minLng: 120.8, maxLng: 121.1 },
    tilesSizeBytes: 52428800,
    routingSizeBytes: 28311552,
    geocodingSizeBytes: 41943040,
  },
  // Africa
  {
    id: 'eg-cairo',
    name: 'Cairo',
    bounds: { minLat: 29.9, maxLat: 30.3, minLng: 31.1, maxLng: 31.5 },
    tilesSizeBytes: 73400320,
    routingSizeBytes: 39845888,
    geocodingSizeBytes: 52428800,
  },
  {
    id: 'ng-lagos',
    name: 'Lagos',
    bounds: { minLat: 6.4, maxLat: 6.7, minLng: 3.1, maxLng: 3.5 },
    tilesSizeBytes: 47185920,
    routingSizeBytes: 25165824,
    geocodingSizeBytes: 36700160,
  },
  {
    id: 'ke-nairobi',
    name: 'Nairobi',
    bounds: { minLat: -1.4, maxLat: -1.1, minLng: 36.7, maxLng: 37.1 },
    tilesSizeBytes: 47185920,
    routingSizeBytes: 25165824,
    geocodingSizeBytes: 36700160,
  },
  {
    id: 'za-cape-town',
    name: 'Cape Town',
    bounds: { minLat: -34.2, maxLat: -33.8, minLng: 18.3, maxLng: 19.0 },
    tilesSizeBytes: 62914560,
    routingSizeBytes: 33554432,
    geocodingSizeBytes: 47185920,
  },
  // Oceania
  {
    id: 'au-sydney',
    name: 'Sydney',
    bounds: { minLat: -34.0, maxLat: -33.7, minLng: 150.9, maxLng: 151.3 },
    tilesSizeBytes: 104857600,
    routingSizeBytes: 55574528,
    geocodingSizeBytes: 73400320,
  },
  {
    id: 'au-melbourne',
    name: 'Melbourne',
    bounds: { minLat: -38.0, maxLat: -37.7, minLng: 144.8, maxLng: 145.2 },
    tilesSizeBytes: 94371840,
    routingSizeBytes: 50331648,
    geocodingSizeBytes: 68157440,
  },
  {
    id: 'nz-auckland',
    name: 'Auckland',
    bounds: { minLat: -37.0, maxLat: -36.7, minLng: 174.6, maxLng: 175.0 },
    tilesSizeBytes: 47185920,
    routingSizeBytes: 25165824,
    geocodingSizeBytes: 36700160,
  },
];
