import { encode as geohashEncode } from '../../utils/geohash';
import { TrafficHistoryService } from './trafficHistoryService';
import { SqliteTrafficHistoryBackend } from './trafficHistorySqlite';
import { InMemoryTrafficHistoryBackend } from './trafficHistoryInMemory';

/**
 * Shared instance of the historical/average traffic condition index.
 *
 * Uses SQLite in production. Falls back to the in-memory backend when the
 * SQLite module is unavailable (e.g. some test environments), which keeps
 * the app functional but non-persistent.
 */
let instance: TrafficHistoryService | null = null;

export function getTrafficHistory(): TrafficHistoryService {
  if (!instance) {
    let backend;
    try {
      backend = new SqliteTrafficHistoryBackend();
    } catch {
      backend = new InMemoryTrafficHistoryBackend();
    }
    instance = new TrafficHistoryService({ backend });
  }
  return instance;
}

/** Reset the singleton (tests only). */
export function resetTrafficHistoryForTests(): void {
  instance = null;
}

/** geohash5 cell (~4.9 km × 4.9 km) containing a coordinate. */
export function geohash5For(lat: number, lng: number): string {
  return geohashEncode(lat, lng, 5);
}

/** Distinct geohash5 cells covering a bounding box, capped to avoid blowups. */
export function geohash5CellsForBounds(
  minLat: number,
  minLng: number,
  maxLat: number,
  maxLng: number,
  maxCells: number = 36,
): string[] {
  const cells = new Set<string>();
  // Grid of sample points inside the bounds; resolution adapts to the cap.
  const stepCount = Math.max(1, Math.ceil(Math.sqrt(maxCells)));
  for (let i = 0; i <= stepCount; i++) {
    for (let j = 0; j <= stepCount; j++) {
      const lat = minLat + ((maxLat - minLat) * i) / stepCount;
      const lng = minLng + ((maxLng - minLng) * j) / stepCount;
      cells.add(geohash5For(lat, lng));
      if (cells.size >= maxCells) return Array.from(cells);
    }
  }
  return Array.from(cells);
}

/** Bucket label helper re-exported for logging. */
export { currentTimeBucket, timeBucketFor } from './trafficTimeBuckets';
export type { TimeBucket, TrafficAreaCondition } from '../../models/trafficHistory';
export type { ConditionObservation } from './trafficHistoryService';
