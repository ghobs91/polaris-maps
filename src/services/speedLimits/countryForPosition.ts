/**
 * Country lookup for a coordinate, used to pick the unit of a Mapillary speed
 * sign.
 *
 * The app carries no country column: a region id is `<iso2>-<subdivision>-
 * <place>` (`us-ny-new-york`) and the `regions` table already stores bounds, so
 * the smallest downloaded extract containing the point answers the question
 * offline. Returning null outside every extract is deliberate — the caller must
 * show nothing rather than guess, because a "50" sign read with the wrong unit is
 * a citation-grade error.
 */

import { getDatabase } from '../database/init';
import { countryCodeFromRegionId } from './mapillarySpeedSigns';

export async function countryCodeForPosition(lat: number, lng: number): Promise<string | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  try {
    const db = await getDatabase();
    const rows = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM regions
        WHERE bounds_min_lat <= ? AND bounds_max_lat >= ?
          AND bounds_min_lng <= ? AND bounds_max_lng >= ?
        ORDER BY (bounds_max_lat - bounds_min_lat) * (bounds_max_lng - bounds_min_lng) ASC
        LIMIT 5`,
      [lat, lat, lng, lng],
    );

    for (const row of rows) {
      const code = countryCodeFromRegionId(row.id);
      if (code) return code;
    }
    return null;
  } catch {
    // No database yet, or a region row with an unexpected id shape. Either way
    // the sign stays blank, which is the safe outcome.
    return null;
  }
}
