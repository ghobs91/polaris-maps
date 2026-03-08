/**
 * Region catalog service.
 *
 * Maintains a bundled list of well-known regions. On first load it queries
 * the Arweave GraphQL API for the latest published transaction IDs for each
 * region's assets, then upserts them into the local database so they appear
 * in the regions list.
 *
 * If the network is unavailable the bundled metadata is still seeded so
 * the user can see available regions and download them later.
 */

import { upsertRegion, getRegionById } from './regionRepository';
import { DATA_BASE_URL, GITHUB_DATA_REPO } from '../../constants/config';
import type { Region } from '../../models/region';

const ARWEAVE_GRAPHQL = 'https://arweave.net/graphql';

interface CatalogEntry {
  id: string;
  name: string;
  bounds: Region['bounds'];
  tilesSizeBytes: number;
  routingSizeBytes: number;
  geocodingSizeBytes: number;
}

/** Bundled list of well-known regions. Sizes are approximate for display. */
const CATALOG: CatalogEntry[] = [
  {
    id: 'us-ca-los-angeles',
    name: 'Los Angeles, CA',
    bounds: { minLat: 33.7, maxLat: 34.4, minLng: -118.7, maxLng: -117.9 },
    tilesSizeBytes: 180 * 1024 * 1024,
    routingSizeBytes: 95 * 1024 * 1024,
    geocodingSizeBytes: 130 * 1024 * 1024,
  },
  {
    id: 'us-ca-san-francisco',
    name: 'San Francisco Bay Area, CA',
    bounds: { minLat: 37.2, maxLat: 38.0, minLng: -122.6, maxLng: -121.5 },
    tilesSizeBytes: 100 * 1024 * 1024,
    routingSizeBytes: 55 * 1024 * 1024,
    geocodingSizeBytes: 80 * 1024 * 1024,
  },
  {
    id: 'us-ny-new-york',
    name: 'New York Metro, NY',
    bounds: { minLat: 40.4, maxLat: 41.0, minLng: -74.3, maxLng: -73.7 },
    tilesSizeBytes: 240 * 1024 * 1024,
    routingSizeBytes: 120 * 1024 * 1024,
    geocodingSizeBytes: 185 * 1024 * 1024,
  },
  {
    id: 'us-il-chicago',
    name: 'Chicago, IL',
    bounds: { minLat: 41.6, maxLat: 42.1, minLng: -88.0, maxLng: -87.5 },
    tilesSizeBytes: 120 * 1024 * 1024,
    routingSizeBytes: 65 * 1024 * 1024,
    geocodingSizeBytes: 90 * 1024 * 1024,
  },
  {
    id: 'us-tx-houston',
    name: 'Houston, TX',
    bounds: { minLat: 29.5, maxLat: 30.1, minLng: -95.6, maxLng: -95.0 },
    tilesSizeBytes: 110 * 1024 * 1024,
    routingSizeBytes: 58 * 1024 * 1024,
    geocodingSizeBytes: 75 * 1024 * 1024,
  },
  {
    id: 'us-wa-seattle',
    name: 'Seattle, WA',
    bounds: { minLat: 47.3, maxLat: 47.8, minLng: -122.5, maxLng: -122.1 },
    tilesSizeBytes: 70 * 1024 * 1024,
    routingSizeBytes: 38 * 1024 * 1024,
    geocodingSizeBytes: 55 * 1024 * 1024,
  },
  {
    id: 'gb-england-london',
    name: 'London, UK',
    bounds: { minLat: 51.3, maxLat: 51.7, minLng: -0.5, maxLng: 0.3 },
    tilesSizeBytes: 210 * 1024 * 1024,
    routingSizeBytes: 105 * 1024 * 1024,
    geocodingSizeBytes: 155 * 1024 * 1024,
  },
  {
    id: 'de-berlin',
    name: 'Berlin, Germany',
    bounds: { minLat: 52.3, maxLat: 52.7, minLng: 13.1, maxLng: 13.7 },
    tilesSizeBytes: 90 * 1024 * 1024,
    routingSizeBytes: 48 * 1024 * 1024,
    geocodingSizeBytes: 65 * 1024 * 1024,
  },
];

interface ArweaveTxIds {
  pmtilesTxId: string | null;
  routingGraphTxId: string | null;
  geocodingDbTxId: string | null;
}

/** Query Arweave GraphQL for the latest published tx IDs for a region. */
async function fetchRegionTxIds(regionId: string): Promise<ArweaveTxIds> {
  const query = `
    query ($regionId: String!) {
      tiles: transactions(
        tags: [
          { name: "App-Name", values: ["Polaris"] }
          { name: "Region", values: [$regionId] }
          { name: "Type", values: ["pmtiles"] }
        ]
        sort: HEIGHT_DESC
        first: 1
      ) { edges { node { id } } }
      routing: transactions(
        tags: [
          { name: "App-Name", values: ["Polaris"] }
          { name: "Region", values: [$regionId] }
          { name: "Type", values: ["routing"] }
        ]
        sort: HEIGHT_DESC
        first: 1
      ) { edges { node { id } } }
      geocoding: transactions(
        tags: [
          { name: "App-Name", values: ["Polaris"] }
          { name: "Region", values: [$regionId] }
          { name: "Type", values: ["geocoding"] }
        ]
        sort: HEIGHT_DESC
        first: 1
      ) { edges { node { id } } }
    }
  `;

  const response = await fetch(ARWEAVE_GRAPHQL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { regionId } }),
  });

  if (!response.ok) throw new Error(`Arweave GraphQL error: ${response.status}`);

  const json = await response.json() as {
    data: {
      tiles: { edges: { node: { id: string } }[] };
      routing: { edges: { node: { id: string } }[] };
      geocoding: { edges: { node: { id: string } }[] };
    };
  };

  return {
    pmtilesTxId: json.data.tiles.edges[0]?.node.id ?? null,
    routingGraphTxId: json.data.routing.edges[0]?.node.id ?? null,
    geocodingDbTxId: json.data.geocoding.edges[0]?.node.id ?? null,
  };
}

/**
 * Seed the local database with the bundled catalog.
 * Existing rows (already downloaded/downloading) are not overwritten.
 * Attempts to fetch live tx IDs from Arweave for each entry, falls back
 * to null tx IDs. When DATA_BASE_URL is configured, regions are downloadable
 * even without Arweave tx IDs (the download service resolves URLs from the
 * data server).
 */
export async function seedCatalog(): Promise<void> {
  await Promise.all(
    CATALOG.map(async (entry) => {
      // Don't overwrite a row that's already being downloaded or complete
      const existing = await getRegionById(entry.id);
      if (existing && existing.downloadStatus !== 'none') return;

      let txIds: ArweaveTxIds = {
        pmtilesTxId: null,
        routingGraphTxId: null,
        geocodingDbTxId: null,
      };

      // Only query Arweave if no local data server or GitHub repo is configured
      if (!DATA_BASE_URL && !GITHUB_DATA_REPO) {
        try {
          txIds = await fetchRegionTxIds(entry.id);
        } catch {
          // Offline or query failed — seed anyway without tx IDs
        }
      }

      const region: Region = {
        id: entry.id,
        name: entry.name,
        bounds: entry.bounds,
        pmtilesTxId: txIds.pmtilesTxId,
        routingGraphTxId: txIds.routingGraphTxId,
        geocodingDbTxId: txIds.geocodingDbTxId,
        version: '1',
        downloadStatus: existing?.downloadStatus ?? 'none',
        tilesSizeBytes: entry.tilesSizeBytes,
        routingSizeBytes: entry.routingSizeBytes,
        geocodingSizeBytes: entry.geocodingSizeBytes,
        downloadedAt: existing?.downloadedAt ?? null,
        lastUpdated: Math.floor(Date.now() / 1000),
      };

      await upsertRegion(region);
    }),
  );
}

/** Return the bundled catalog list (without hitting the DB). */
export function getCatalogIds(): string[] {
  return CATALOG.map((e) => e.id);
}
