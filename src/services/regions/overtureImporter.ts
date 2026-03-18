import * as FileSystem from 'expo-file-system';
import { importOverturePlacesFromGeoJSON } from '../poi/overtureFetcher';
import type { OverturePlaceCollection } from '../../types/overture';

/**
 * Import Overture Maps places bundled with a downloaded region.
 *
 * Looks for an `overture-places.geojson` file in the region directory
 * (produced by `scripts/generate-region-data.sh` step 5) and upserts
 * all valid features into the local SQLite `places` table with
 * source='overture'.
 *
 * Safe to call even if the file doesn't exist (returns 0).
 */
export async function importRegionOverturePlaces(regionDir: string): Promise<number> {
  const filePath = `${regionDir}overture-places.geojson`;

  const info = await FileSystem.getInfoAsync(filePath);
  if (!info.exists) return 0;

  const raw = await FileSystem.readAsStringAsync(filePath);
  const geojson: OverturePlaceCollection = JSON.parse(raw);

  if (geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
    return 0;
  }

  return importOverturePlacesFromGeoJSON(geojson);
}
