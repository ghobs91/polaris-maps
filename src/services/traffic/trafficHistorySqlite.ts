import type { TrafficHistoryBackend } from './trafficHistoryService';
import type { TimeBucket, TrafficAreaCondition } from '../../models/trafficHistory';

/**
 * SQLite-backed implementation of the historical traffic condition index.
 *
 * Uses expo-sqlite (already an app dependency). The table is keyed by
 * (geohash5, day_of_week, half_hour); each row holds EMA-merged averages.
 *
 * expo-sqlite is required lazily (inside db()) so this module can be imported
 * in environments where the native SQLite module is unavailable; unit tests
 * use {@link InMemoryTrafficHistoryBackend} instead.
 */

type SqliteDb = import('expo-sqlite').SQLiteDatabase;

function openDb(): Promise<SqliteDb> {
  // Lazy require — expo-sqlite fails to load in non-native environments.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { openDatabaseAsync } = require('expo-sqlite') as typeof import('expo-sqlite');
  return openDatabaseAsync('traffic-history.db');
}

export class SqliteTrafficHistoryBackend implements TrafficHistoryBackend {
  private dbPromise: Promise<SqliteDb> | null = null;

  private db(): Promise<SqliteDb> {
    if (!this.dbPromise) {
      this.dbPromise = openDb();
    }
    return this.dbPromise;
  }

  async init(): Promise<void> {
    const db = await this.db();
    await db.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS traffic_conditions (
        geohash5 TEXT NOT NULL,
        day_of_week INTEGER NOT NULL,
        half_hour INTEGER NOT NULL,
        avg_speed_mph REAL NOT NULL,
        avg_congestion_ratio REAL NOT NULL,
        free_flow_speed_mph REAL NOT NULL,
        sample_count INTEGER NOT NULL,
        last_updated INTEGER NOT NULL,
        PRIMARY KEY (geohash5, day_of_week, half_hour)
      );
    `);
  }

  async insert(condition: TrafficAreaCondition): Promise<void> {
    const db = await this.db();
    await db.runAsync(
      `INSERT OR REPLACE INTO traffic_conditions
        (geohash5, day_of_week, half_hour, avg_speed_mph, avg_congestion_ratio,
         free_flow_speed_mph, sample_count, last_updated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      condition.geohash5,
      condition.dayOfWeek,
      condition.halfHour,
      condition.avgSpeedMph,
      condition.avgCongestionRatio,
      condition.freeFlowSpeedMph,
      condition.sampleCount,
      condition.lastUpdated,
    );
  }

  async update(condition: TrafficAreaCondition): Promise<void> {
    const db = await this.db();
    await db.runAsync(
      `UPDATE traffic_conditions SET
        avg_speed_mph = ?, avg_congestion_ratio = ?, free_flow_speed_mph = ?,
        sample_count = ?, last_updated = ?
       WHERE geohash5 = ? AND day_of_week = ? AND half_hour = ?`,
      condition.avgSpeedMph,
      condition.avgCongestionRatio,
      condition.freeFlowSpeedMph,
      condition.sampleCount,
      condition.lastUpdated,
      condition.geohash5,
      condition.dayOfWeek,
      condition.halfHour,
    );
  }

  async getByKey(cells: string[], bucket: TimeBucket): Promise<TrafficAreaCondition[]> {
    if (cells.length === 0) return [];
    const db = await this.db();
    const placeholders = cells.map(() => '?').join(',');
    const rows = await db.getAllAsync<{
      geohash5: string;
      day_of_week: number;
      half_hour: number;
      avg_speed_mph: number;
      avg_congestion_ratio: number;
      free_flow_speed_mph: number;
      sample_count: number;
      last_updated: number;
    }>(
      `SELECT geohash5, day_of_week, half_hour, avg_speed_mph, avg_congestion_ratio,
              free_flow_speed_mph, sample_count, last_updated
       FROM traffic_conditions
       WHERE geohash5 IN (${placeholders}) AND day_of_week = ? AND half_hour = ?`,
      ...cells,
      bucket.dayOfWeek,
      bucket.halfHour,
    );
    return rows.map((r) => ({
      geohash5: r.geohash5,
      dayOfWeek: r.day_of_week,
      halfHour: r.half_hour,
      avgSpeedMph: r.avg_speed_mph,
      avgCongestionRatio: r.avg_congestion_ratio,
      freeFlowSpeedMph: r.free_flow_speed_mph,
      sampleCount: r.sample_count,
      lastUpdated: r.last_updated,
    }));
  }

  async getAll(): Promise<TrafficAreaCondition[]> {
    const db = await this.db();
    const rows = await db.getAllAsync<{
      geohash5: string;
      day_of_week: number;
      half_hour: number;
      avg_speed_mph: number;
      avg_congestion_ratio: number;
      free_flow_speed_mph: number;
      sample_count: number;
      last_updated: number;
    }>(
      `SELECT geohash5, day_of_week, half_hour, avg_speed_mph, avg_congestion_ratio,
              free_flow_speed_mph, sample_count, last_updated
       FROM traffic_conditions`,
    );
    return rows.map((r) => ({
      geohash5: r.geohash5,
      dayOfWeek: r.day_of_week,
      halfHour: r.half_hour,
      avgSpeedMph: r.avg_speed_mph,
      avgCongestionRatio: r.avg_congestion_ratio,
      freeFlowSpeedMph: r.free_flow_speed_mph,
      sampleCount: r.sample_count,
      lastUpdated: r.last_updated,
    }));
  }

  async remove(cell: string, bucket: TimeBucket): Promise<void> {
    const db = await this.db();
    await db.runAsync(
      `DELETE FROM traffic_conditions WHERE geohash5 = ? AND day_of_week = ? AND half_hour = ?`,
      cell,
      bucket.dayOfWeek,
      bucket.halfHour,
    );
  }

  async count(): Promise<number> {
    const db = await this.db();
    const row = await db.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM traffic_conditions`,
    );
    return row?.n ?? 0;
  }

  async close(): Promise<void> {
    if (this.dbPromise) {
      const db = await this.dbPromise;
      await db.closeAsync();
      this.dbPromise = null;
    }
  }
}
