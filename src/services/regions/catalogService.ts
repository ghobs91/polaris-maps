/**
 * Region catalog service.
 *
 * Fetches the master region catalog from CDN and seeds the local regions table.
 * Caches the catalog JSON in MMKV for instant offline access on subsequent launches.
 */

import { storage } from '../storage/mmkv';
import { isOnline } from './connectivityService';
import { upsertRegion, getRegionById } from './regionRepository';
import { REGION_CATALOG_URL } from '../../constants/config';
import type { Region, RegionDownloadStatus } from '../../models/region';

const MMKV_CATALOG_KEY = 'region_catalog_v1';

interface CatalogManifest {
  version: string;
  updated_at: string;
  regions: CatalogEntry[];
}

interface CatalogEntry {
  id: string;
  name: string;
  version: string;
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number };
  geocodingUrl?: string;
  geocodingSizeBytes?: number;
  placesUrl?: string;
  placesSizeBytes?: number;
}

/**
 * Fetch the region catalog from CDN and seed local DB.
 *
 * - Seeds immediately from MMKV cache (so UI is instant on subsequent launches).
 * - Then fetches fresh catalog from network and updates MMKV + DB.
 * - Only creates region rows for regions that are NOT already downloaded (complete).
 */
export async function fetchAndSeedCatalog(): Promise<void> {
  // 1. Seed from MMKV cache first (instant, offline-safe)
  const cached = storage.getString(MMKV_CATALOG_KEY);
  if (cached) {
    try {
      const manifest: CatalogManifest = JSON.parse(cached);
      await seedFromManifest(manifest);
    } catch {
      // Corrupted cache — ignore
    }
  }

  // 2. If online, fetch fresh catalog
  if (!isOnline()) return;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);

    const res = await fetch(REGION_CATALOG_URL, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timer);

    if (!res.ok) return;

    const raw = await res.text();
    const manifest: CatalogManifest = JSON.parse(raw);

    // Cache the raw JSON in MMKV
    storage.set(MMKV_CATALOG_KEY, raw);

    await seedFromManifest(manifest);
  } catch {
    // Network error — silently use cached version
  }
}

/**
 * Returns array of region IDs from the cached MMKV manifest.
 */
export function getCatalogIds(): string[] {
  const cached = storage.getString(MMKV_CATALOG_KEY);
  if (!cached) return [];
  try {
    const manifest: CatalogManifest = JSON.parse(cached);
    return manifest.regions.map((r) => r.id);
  } catch {
    return [];
  }
}

async function seedFromManifest(manifest: CatalogManifest): Promise<void> {
  for (const entry of manifest.regions) {
    // Only seed if the region is not already fully downloaded
    const existing = await getRegionById(entry.id);
    if (existing?.downloadStatus === 'complete') continue;

    const region: Region = {
      id: entry.id,
      name: entry.name,
      bounds: entry.bounds,
      version: entry.version,
      downloadStatus: (existing?.downloadStatus as RegionDownloadStatus) ?? 'none',
      tilesSizeBytes: existing?.tilesSizeBytes ?? null,
      routingSizeBytes: existing?.routingSizeBytes ?? null,
      geocodingSizeBytes: entry.geocodingSizeBytes ?? null,
      downloadedAt: existing?.downloadedAt ?? null,
      lastUpdated: existing?.lastUpdated ?? null,
      driveKey: existing?.driveKey ?? null,
      geocodingUrl: entry.geocodingUrl ?? null,
    };

    await upsertRegion(region);
  }
}
