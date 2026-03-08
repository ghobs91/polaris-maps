/**
 * Region catalog service.
 *
 * Maintains a bundled list of well-known regions. On first load it seeds
 * the local database so they appear in the regions list.
 *
 * If the network is unavailable the bundled metadata is still seeded so
 * the user can see available regions and download them later.
 */

import { upsertRegion, getRegionById } from './regionRepository';
import type { Region } from '../../models/region';

interface CatalogEntry {
  id: string;
  name: string;
  bounds: Region['bounds'];
  tilesSizeBytes: number;
  routingSizeBytes: number;
  geocodingSizeBytes: number;
}

/**
 * Bundled catalog of metro regions.
 *
 * This list is the single source of truth for both the in-app regions browser
 * and the CI build pipeline (scripts/regions.json mirrors this data for jq).
 * To add global coverage, append an entry here and create a matching entry in
 * scripts/regions.json — CI will auto-build it on the next weekly run.
 *
 * Sizes are approximate display estimates in bytes.
 */
const CATALOG: CatalogEntry[] = [
  // ── North America ──────────────────────────────────────────────────────────
  {
    id: 'us-ny-new-york',
    name: 'New York Metro',
    bounds: { minLat: 40.4, maxLat: 41.0, minLng: -74.3, maxLng: -73.7 },
    tilesSizeBytes: 240 * 1024 * 1024,
    routingSizeBytes: 120 * 1024 * 1024,
    geocodingSizeBytes: 185 * 1024 * 1024,
  },
  {
    id: 'us-ca-los-angeles',
    name: 'Los Angeles',
    bounds: { minLat: 33.7, maxLat: 34.4, minLng: -118.7, maxLng: -117.9 },
    tilesSizeBytes: 180 * 1024 * 1024,
    routingSizeBytes: 95 * 1024 * 1024,
    geocodingSizeBytes: 130 * 1024 * 1024,
  },
  {
    id: 'us-ca-san-francisco',
    name: 'San Francisco Bay Area',
    bounds: { minLat: 37.2, maxLat: 38.0, minLng: -122.6, maxLng: -121.5 },
    tilesSizeBytes: 100 * 1024 * 1024,
    routingSizeBytes: 55 * 1024 * 1024,
    geocodingSizeBytes: 80 * 1024 * 1024,
  },
  {
    id: 'us-il-chicago',
    name: 'Chicago',
    bounds: { minLat: 41.6, maxLat: 42.1, minLng: -88.0, maxLng: -87.5 },
    tilesSizeBytes: 120 * 1024 * 1024,
    routingSizeBytes: 65 * 1024 * 1024,
    geocodingSizeBytes: 90 * 1024 * 1024,
  },
  {
    id: 'us-tx-houston',
    name: 'Houston',
    bounds: { minLat: 29.5, maxLat: 30.1, minLng: -95.6, maxLng: -95.0 },
    tilesSizeBytes: 110 * 1024 * 1024,
    routingSizeBytes: 58 * 1024 * 1024,
    geocodingSizeBytes: 75 * 1024 * 1024,
  },
  {
    id: 'us-wa-seattle',
    name: 'Seattle',
    bounds: { minLat: 47.3, maxLat: 47.8, minLng: -122.5, maxLng: -122.1 },
    tilesSizeBytes: 70 * 1024 * 1024,
    routingSizeBytes: 38 * 1024 * 1024,
    geocodingSizeBytes: 55 * 1024 * 1024,
  },
  {
    id: 'us-fl-miami',
    name: 'Miami',
    bounds: { minLat: 25.5, maxLat: 25.9, minLng: -80.5, maxLng: -80.0 },
    tilesSizeBytes: 60 * 1024 * 1024,
    routingSizeBytes: 32 * 1024 * 1024,
    geocodingSizeBytes: 45 * 1024 * 1024,
  },
  {
    id: 'us-ma-boston',
    name: 'Boston',
    bounds: { minLat: 42.2, maxLat: 42.5, minLng: -71.2, maxLng: -70.9 },
    tilesSizeBytes: 50 * 1024 * 1024,
    routingSizeBytes: 27 * 1024 * 1024,
    geocodingSizeBytes: 40 * 1024 * 1024,
  },
  {
    id: 'us-az-phoenix',
    name: 'Phoenix',
    bounds: { minLat: 33.2, maxLat: 33.8, minLng: -112.5, maxLng: -111.7 },
    tilesSizeBytes: 75 * 1024 * 1024,
    routingSizeBytes: 40 * 1024 * 1024,
    geocodingSizeBytes: 55 * 1024 * 1024,
  },
  {
    id: 'ca-on-toronto',
    name: 'Toronto',
    bounds: { minLat: 43.5, maxLat: 43.9, minLng: -79.7, maxLng: -79.1 },
    tilesSizeBytes: 90 * 1024 * 1024,
    routingSizeBytes: 48 * 1024 * 1024,
    geocodingSizeBytes: 65 * 1024 * 1024,
  },
  {
    id: 'ca-bc-vancouver',
    name: 'Vancouver',
    bounds: { minLat: 49.1, maxLat: 49.4, minLng: -123.3, maxLng: -122.9 },
    tilesSizeBytes: 60 * 1024 * 1024,
    routingSizeBytes: 32 * 1024 * 1024,
    geocodingSizeBytes: 45 * 1024 * 1024,
  },
  {
    id: 'mx-mexico-city',
    name: 'Mexico City',
    bounds: { minLat: 19.1, maxLat: 19.7, minLng: -99.4, maxLng: -98.8 },
    tilesSizeBytes: 100 * 1024 * 1024,
    routingSizeBytes: 53 * 1024 * 1024,
    geocodingSizeBytes: 70 * 1024 * 1024,
  },
  // ── South America ──────────────────────────────────────────────────────────
  {
    id: 'br-sao-paulo',
    name: 'São Paulo',
    bounds: { minLat: -24.0, maxLat: -23.4, minLng: -46.8, maxLng: -46.3 },
    tilesSizeBytes: 130 * 1024 * 1024,
    routingSizeBytes: 68 * 1024 * 1024,
    geocodingSizeBytes: 90 * 1024 * 1024,
  },
  {
    id: 'ar-buenos-aires',
    name: 'Buenos Aires',
    bounds: { minLat: -34.7, maxLat: -34.5, minLng: -58.6, maxLng: -58.2 },
    tilesSizeBytes: 75 * 1024 * 1024,
    routingSizeBytes: 40 * 1024 * 1024,
    geocodingSizeBytes: 55 * 1024 * 1024,
  },
  {
    id: 'co-bogota',
    name: 'Bogotá',
    bounds: { minLat: 4.5, maxLat: 4.8, minLng: -74.2, maxLng: -73.9 },
    tilesSizeBytes: 60 * 1024 * 1024,
    routingSizeBytes: 32 * 1024 * 1024,
    geocodingSizeBytes: 45 * 1024 * 1024,
  },
  // ── Europe ─────────────────────────────────────────────────────────────────
  {
    id: 'gb-england-london',
    name: 'London',
    bounds: { minLat: 51.3, maxLat: 51.7, minLng: -0.5, maxLng: 0.3 },
    tilesSizeBytes: 210 * 1024 * 1024,
    routingSizeBytes: 105 * 1024 * 1024,
    geocodingSizeBytes: 155 * 1024 * 1024,
  },
  {
    id: 'de-berlin',
    name: 'Berlin',
    bounds: { minLat: 52.3, maxLat: 52.7, minLng: 13.1, maxLng: 13.7 },
    tilesSizeBytes: 90 * 1024 * 1024,
    routingSizeBytes: 48 * 1024 * 1024,
    geocodingSizeBytes: 65 * 1024 * 1024,
  },
  {
    id: 'fr-paris',
    name: 'Paris',
    bounds: { minLat: 48.5, maxLat: 49.1, minLng: 2.0, maxLng: 3.0 },
    tilesSizeBytes: 180 * 1024 * 1024,
    routingSizeBytes: 95 * 1024 * 1024,
    geocodingSizeBytes: 130 * 1024 * 1024,
  },
  {
    id: 'es-madrid',
    name: 'Madrid',
    bounds: { minLat: 40.2, maxLat: 40.6, minLng: -3.9, maxLng: -3.5 },
    tilesSizeBytes: 75 * 1024 * 1024,
    routingSizeBytes: 40 * 1024 * 1024,
    geocodingSizeBytes: 55 * 1024 * 1024,
  },
  {
    id: 'it-rome',
    name: 'Rome',
    bounds: { minLat: 41.7, maxLat: 42.0, minLng: 12.3, maxLng: 12.6 },
    tilesSizeBytes: 70 * 1024 * 1024,
    routingSizeBytes: 38 * 1024 * 1024,
    geocodingSizeBytes: 55 * 1024 * 1024,
  },
  {
    id: 'nl-amsterdam',
    name: 'Amsterdam',
    bounds: { minLat: 52.2, maxLat: 52.5, minLng: 4.7, maxLng: 5.1 },
    tilesSizeBytes: 55 * 1024 * 1024,
    routingSizeBytes: 29 * 1024 * 1024,
    geocodingSizeBytes: 40 * 1024 * 1024,
  },
  {
    id: 'tr-istanbul',
    name: 'Istanbul',
    bounds: { minLat: 40.8, maxLat: 41.2, minLng: 28.7, maxLng: 29.3 },
    tilesSizeBytes: 100 * 1024 * 1024,
    routingSizeBytes: 53 * 1024 * 1024,
    geocodingSizeBytes: 70 * 1024 * 1024,
  },
  {
    id: 'ru-moscow',
    name: 'Moscow',
    bounds: { minLat: 55.5, maxLat: 56.0, minLng: 37.3, maxLng: 37.9 },
    tilesSizeBytes: 120 * 1024 * 1024,
    routingSizeBytes: 63 * 1024 * 1024,
    geocodingSizeBytes: 84 * 1024 * 1024,
  },
  {
    id: 'pl-warsaw',
    name: 'Warsaw',
    bounds: { minLat: 52.0, maxLat: 52.4, minLng: 20.8, maxLng: 21.3 },
    tilesSizeBytes: 55 * 1024 * 1024,
    routingSizeBytes: 29 * 1024 * 1024,
    geocodingSizeBytes: 40 * 1024 * 1024,
  },
  // ── Asia ───────────────────────────────────────────────────────────────────
  {
    id: 'jp-tokyo',
    name: 'Tokyo',
    bounds: { minLat: 35.5, maxLat: 35.9, minLng: 139.5, maxLng: 140.0 },
    tilesSizeBytes: 250 * 1024 * 1024,
    routingSizeBytes: 130 * 1024 * 1024,
    geocodingSizeBytes: 180 * 1024 * 1024,
  },
  {
    id: 'in-delhi',
    name: 'Delhi',
    bounds: { minLat: 28.4, maxLat: 28.9, minLng: 76.8, maxLng: 77.4 },
    tilesSizeBytes: 90 * 1024 * 1024,
    routingSizeBytes: 48 * 1024 * 1024,
    geocodingSizeBytes: 65 * 1024 * 1024,
  },
  {
    id: 'in-mumbai',
    name: 'Mumbai',
    bounds: { minLat: 18.9, maxLat: 19.3, minLng: 72.7, maxLng: 73.0 },
    tilesSizeBytes: 75 * 1024 * 1024,
    routingSizeBytes: 40 * 1024 * 1024,
    geocodingSizeBytes: 55 * 1024 * 1024,
  },
  {
    id: 'kr-seoul',
    name: 'Seoul',
    bounds: { minLat: 37.4, maxLat: 37.7, minLng: 126.7, maxLng: 127.2 },
    tilesSizeBytes: 120 * 1024 * 1024,
    routingSizeBytes: 63 * 1024 * 1024,
    geocodingSizeBytes: 84 * 1024 * 1024,
  },
  {
    id: 'sg-singapore',
    name: 'Singapore',
    bounds: { minLat: 1.1, maxLat: 1.5, minLng: 103.6, maxLng: 104.1 },
    tilesSizeBytes: 50 * 1024 * 1024,
    routingSizeBytes: 27 * 1024 * 1024,
    geocodingSizeBytes: 40 * 1024 * 1024,
  },
  {
    id: 'th-bangkok',
    name: 'Bangkok',
    bounds: { minLat: 13.6, maxLat: 14.0, minLng: 100.3, maxLng: 101.0 },
    tilesSizeBytes: 70 * 1024 * 1024,
    routingSizeBytes: 38 * 1024 * 1024,
    geocodingSizeBytes: 50 * 1024 * 1024,
  },
  {
    id: 'id-jakarta',
    name: 'Jakarta',
    bounds: { minLat: -6.4, maxLat: -6.1, minLng: 106.6, maxLng: 107.1 },
    tilesSizeBytes: 70 * 1024 * 1024,
    routingSizeBytes: 38 * 1024 * 1024,
    geocodingSizeBytes: 50 * 1024 * 1024,
  },
  {
    id: 'ph-manila',
    name: 'Manila',
    bounds: { minLat: 14.4, maxLat: 14.8, minLng: 120.8, maxLng: 121.1 },
    tilesSizeBytes: 50 * 1024 * 1024,
    routingSizeBytes: 27 * 1024 * 1024,
    geocodingSizeBytes: 40 * 1024 * 1024,
  },
  // ── Africa ─────────────────────────────────────────────────────────────────
  {
    id: 'eg-cairo',
    name: 'Cairo',
    bounds: { minLat: 29.9, maxLat: 30.3, minLng: 31.1, maxLng: 31.5 },
    tilesSizeBytes: 70 * 1024 * 1024,
    routingSizeBytes: 38 * 1024 * 1024,
    geocodingSizeBytes: 50 * 1024 * 1024,
  },
  {
    id: 'ng-lagos',
    name: 'Lagos',
    bounds: { minLat: 6.4, maxLat: 6.7, minLng: 3.1, maxLng: 3.5 },
    tilesSizeBytes: 45 * 1024 * 1024,
    routingSizeBytes: 24 * 1024 * 1024,
    geocodingSizeBytes: 35 * 1024 * 1024,
  },
  {
    id: 'ke-nairobi',
    name: 'Nairobi',
    bounds: { minLat: -1.4, maxLat: -1.1, minLng: 36.7, maxLng: 37.1 },
    tilesSizeBytes: 45 * 1024 * 1024,
    routingSizeBytes: 24 * 1024 * 1024,
    geocodingSizeBytes: 35 * 1024 * 1024,
  },
  {
    id: 'za-cape-town',
    name: 'Cape Town',
    bounds: { minLat: -34.2, maxLat: -33.8, minLng: 18.3, maxLng: 19.0 },
    tilesSizeBytes: 60 * 1024 * 1024,
    routingSizeBytes: 32 * 1024 * 1024,
    geocodingSizeBytes: 45 * 1024 * 1024,
  },
  // ── Oceania ────────────────────────────────────────────────────────────────
  {
    id: 'au-sydney',
    name: 'Sydney',
    bounds: { minLat: -34.0, maxLat: -33.7, minLng: 150.9, maxLng: 151.3 },
    tilesSizeBytes: 100 * 1024 * 1024,
    routingSizeBytes: 53 * 1024 * 1024,
    geocodingSizeBytes: 70 * 1024 * 1024,
  },
  {
    id: 'au-melbourne',
    name: 'Melbourne',
    bounds: { minLat: -38.0, maxLat: -37.7, minLng: 144.8, maxLng: 145.2 },
    tilesSizeBytes: 90 * 1024 * 1024,
    routingSizeBytes: 48 * 1024 * 1024,
    geocodingSizeBytes: 65 * 1024 * 1024,
  },
  {
    id: 'nz-auckland',
    name: 'Auckland',
    bounds: { minLat: -37.0, maxLat: -36.7, minLng: 174.6, maxLng: 175.0 },
    tilesSizeBytes: 45 * 1024 * 1024,
    routingSizeBytes: 24 * 1024 * 1024,
    geocodingSizeBytes: 35 * 1024 * 1024,
  },
];

/**
 * Seed the local database with the bundled catalog.
 * Existing rows (already downloaded/downloading) are not overwritten.
 */
export async function seedCatalog(): Promise<void> {
  await Promise.all(
    CATALOG.map(async (entry) => {
      // Don't overwrite a row that's already being downloaded or complete
      const existing = await getRegionById(entry.id);
      if (existing && existing.downloadStatus !== 'none') return;

      const region: Region = {
        id: entry.id,
        name: entry.name,
        bounds: entry.bounds,
        version: '1',
        downloadStatus: existing?.downloadStatus ?? 'none',
        tilesSizeBytes: entry.tilesSizeBytes,
        routingSizeBytes: entry.routingSizeBytes,
        geocodingSizeBytes: entry.geocodingSizeBytes,
        downloadedAt: existing?.downloadedAt ?? null,
        lastUpdated: Math.floor(Date.now() / 1000),
        driveKey: existing?.driveKey ?? null,
      };

      await upsertRegion(region);
    }),
  );
}

/** Return the bundled catalog list (without hitting the DB). */
export function getCatalogIds(): string[] {
  return CATALOG.map((e) => e.id);
}
