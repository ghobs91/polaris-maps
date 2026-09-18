import * as FileSystem from 'expo-file-system/legacy';
import { seedPlaceDetails, type RegionPlaceDetailSeed } from '../places/placeDetailCache';

/**
 * Import optional `region_place_details.json` bundled with a downloaded region
 * into the place-detail cache. Region seeds use sourceVersion 0 so they never
 * overwrite a fresher live snapshot. Returns the number of rows seeded.
 */
export async function importRegionPlaceDetails(regionDir: string): Promise<number> {
  const filePath = `${regionDir}region_place_details.json`;
  const info = await FileSystem.getInfoAsync(filePath);
  if (!info.exists) return 0;

  const raw = await FileSystem.readAsStringAsync(filePath);
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) return 0;

  return seedPlaceDetails(parsed as RegionPlaceDetailSeed[]);
}
