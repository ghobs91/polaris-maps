import { getDownloadedRegions } from './regionRepository';
import { fetchLatestTileVersion } from './downloadService';
import type { Region } from '../../models/region';

/**
 * Check all downloaded regions for available tile data updates.
 *
 * Compares each downloaded region's stored `tileVersion` against the latest
 * version reported by OpenFreeMap's TileJSON endpoint. Regions whose stored
 * version differs from the latest (or whose version is null — never had a
 * version stored) are considered stale.
 *
 * @returns Array of regions that have updates available.
 */
export async function checkForRegionUpdates(): Promise<Region[]> {
  const latestVersion = await fetchLatestTileVersion();
  if (!latestVersion) return [];

  const downloaded = await getDownloadedRegions();

  return downloaded.filter((region) => {
    // If no tile version was ever stored, the data may be stale
    if (!region.tileVersion) return true;
    // Compare date-stamps — different means the tiles have been rebuilt
    return region.tileVersion !== latestVersion;
  });
}

/**
 * Check a single region for updates.
 *
 * @returns true if an update is available (stored version doesn't match latest).
 */
export async function regionHasUpdate(region: Region): Promise<boolean> {
  if (!region.tileVersion) {
    const latest = await fetchLatestTileVersion();
    return latest !== null;
  }

  const latest = await fetchLatestTileVersion();
  return latest !== null && region.tileVersion !== latest;
}
