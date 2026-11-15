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

/** Bucket label helper re-exported for logging. */
export { currentTimeBucket, timeBucketFor } from './trafficTimeBuckets';
export type { TimeBucket, TrafficAreaCondition } from '../../models/trafficHistory';
export type { ConditionObservation } from './trafficHistoryService';
