/**
 * Region catalog service.
 *
 * Fetches the master region catalog from CDN and seeds the local regions table.
 * Caches the catalog JSON in MMKV for instant offline access on subsequent launches.
 */

import { storage } from '../storage/mmkv';
import { isOnline } from './connectivityService';
import { upsertRegion, getRegionById } from './regionRepository';
import { setRemoteRegionManifests } from './regionManifestResolver';
import { REGION_CATALOG_URL } from '../../constants/config';
import { logDiagnostic } from '../diagnostics/diagnosticsLog';
import type { RegionManifest } from './regionManifest';
import type { Region, RegionDownloadStatus } from '../../models/region';

const MMKV_CATALOG_KEY = 'region_catalog_v1';

interface CatalogManifest {
  version: string;
  updated_at: string;
  regions: CatalogEntry[];
  /** Verified remote region-pack manifests, merged over the bundled set. */
  manifests?: RegionManifest[];
  /** Release tag the asset URLs were stamped from, when published. */
  assetTag?: string;
  /**
   * Origins serving `<base>/<assetTag>/<assetName>` — the pack CDN, as a list.
   * GitHub Releases is first; Cloudflare R2, Backblaze B2 and the Internet
   * Archive follow. The downloader rotates between them and verifies each
   * transfer against the catalog's checksum.
   */
  assetBaseUrls?: string[];
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
  /** Optional on-device POI index asset (see Region.searchIndexUrl). */
  searchIndexUrl?: string;
  searchIndexSizeBytes?: number;
  /** Optional on-device transit index asset (see Region.transitIndexUrl). */
  transitIndexUrl?: string;
  transitIndexSizeBytes?: number;
  /** Optional per-entry signed manifest with the region's canonical drive key. */
  manifest?: RegionManifest;
}

/**
 * Hosts that only ever appear in examples and documentation.
 *
 * A build that ships one of these cannot fetch a catalog, and it fails quietly
 * (the fetch is best-effort), which is exactly the sort of thing that reaches
 * users. Detect it explicitly instead.
 */
const PLACEHOLDER_HOSTS = ['example.com', 'example.net', 'example.org'];

/** True when a URL points at a documented placeholder (or is unusable). */
export function isPlaceholderUrl(url: string | null | undefined): boolean {
  if (!url) return true;
  try {
    const { hostname } = new URL(url);
    return PLACEHOLDER_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
  } catch {
    return true;
  }
}

/**
 * True when a real catalog origin is configured.
 *
 * Polaris hosts no CDN, so this is whatever community/third-party origin serves
 * the packs — but it must not be a placeholder.
 */
export function isRegionCatalogConfigured(url: string = REGION_CATALOG_URL): boolean {
  return !isPlaceholderUrl(url);
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

  if (!isRegionCatalogConfigured()) {
    // A cached catalog still works; a placeholder origin can never be fetched.
    logDiagnostic('regions', 'warn', 'region catalog origin is a placeholder', {
      url: REGION_CATALOG_URL,
    });
    return;
  }

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

export interface CatalogAssetOrigins {
  /** Release tag the catalog's asset URLs were stamped from (null when absent). */
  tag: string | null;
  /** Base URLs serving `<base>/<tag>/<assetName>`, primary first. */
  baseUrls: string[];
}

/**
 * Multi-origin publication metadata from the cached catalog.
 *
 * Lets the routing-graph downloader resolve a tarball against every mirror
 * (GitHub, R2, B2, Internet Archive) instead of hard-coding the GitHub
 * Releases path, and without a GitHub API round trip for the current tag.
 */
export function getCatalogAssetOrigins(): CatalogAssetOrigins {
  const cached = storage.getString(MMKV_CATALOG_KEY);
  if (!cached) return { tag: null, baseUrls: [] };
  try {
    const manifest = JSON.parse(cached) as CatalogManifest;
    const baseUrls = (manifest.assetBaseUrls ?? [])
      .filter((url): url is string => typeof url === 'string' && url.trim().length > 0)
      .map((url) => url.trim().replace(/\/+$/, ''));
    return { tag: manifest.assetTag ?? null, baseUrls };
  } catch {
    return { tag: null, baseUrls: [] };
  }
}

async function seedFromManifest(manifest: CatalogManifest): Promise<void> {
  // Feed any signed manifests into the resolver (verified lazily on merge; the
  // bundled manifest always wins). Root-level entries plus per-region ones.
  const remoteManifests: RegionManifest[] = [
    ...(manifest.manifests ?? []),
    ...manifest.regions
      .map((entry) => entry.manifest)
      .filter((m): m is RegionManifest => m != null),
  ];
  setRemoteRegionManifests(remoteManifests);

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
      placesUrl: entry.placesUrl ?? null,
      placesSizeBytes: entry.placesSizeBytes ?? null,
      searchIndexUrl: entry.searchIndexUrl ?? null,
      searchIndexSizeBytes: entry.searchIndexSizeBytes ?? null,
      transitIndexUrl: entry.transitIndexUrl ?? null,
      transitIndexSizeBytes: entry.transitIndexSizeBytes ?? null,
      tileVersion: existing?.tileVersion ?? null,
    };

    await upsertRegion(region);
  }
}
