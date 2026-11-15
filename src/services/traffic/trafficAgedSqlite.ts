import type { AgedTrafficBackend, AgedTrafficRow } from './trafficAgedStore';
import type { NormalizedTrafficSegment } from '../../models/traffic';

/**
 * SQLite backend for the aged traffic store.
 *
 * A separate database from the weekly condition index on purpose: this table
 * is high-churn and short-lived (hours), while `traffic-history.db` holds
 * long-lived probe-derived weekly profiles. Mixing them would put licensed
 * upstream rows under the profile pruning rules and vice versa.
 *
 * expo-sqlite is required lazily so this module can be imported where the
 * native module is unavailable (unit tests use the in-memory backend).
 */

type SqliteDb = import('expo-sqlite').SQLiteDatabase;

const DB_NAME = 'traffic-aged.db';

function openDb(): Promise<SqliteDb> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { openDatabaseAsync } = require('expo-sqlite') as typeof import('expo-sqlite');
  return openDatabaseAsync(DB_NAME);
}

interface Row {
  cell: string;
  segment_id: string;
  coordinates: string;
  source: string;
  current_speed_mph: number;
  free_flow_speed_mph: number;
  congestion_ratio: number;
  confidence: number;
  observed_at: number;
}

export class SqliteAgedTrafficBackend implements AgedTrafficBackend {
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
      CREATE TABLE IF NOT EXISTS traffic_aged (
        cell TEXT NOT NULL,
        segment_id TEXT NOT NULL,
        coordinates TEXT NOT NULL,
        source TEXT NOT NULL,
        current_speed_mph REAL NOT NULL,
        free_flow_speed_mph REAL NOT NULL,
        congestion_ratio REAL NOT NULL,
        confidence REAL NOT NULL,
        observed_at INTEGER NOT NULL,
        PRIMARY KEY (cell, segment_id)
      );
      CREATE INDEX IF NOT EXISTS idx_traffic_aged_observed
        ON traffic_aged(observed_at);
    `);
  }

  async upsert(rows: AgedTrafficRow[]): Promise<void> {
    if (rows.length === 0) return;
    const db = await this.db();
    for (const row of rows) {
      await db.runAsync(
        `INSERT INTO traffic_aged
          (cell, segment_id, coordinates, source, current_speed_mph,
           free_flow_speed_mph, congestion_ratio, confidence, observed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(cell, segment_id) DO UPDATE SET
           coordinates = excluded.coordinates,
           source = excluded.source,
           current_speed_mph = excluded.current_speed_mph,
           free_flow_speed_mph = excluded.free_flow_speed_mph,
           congestion_ratio = excluded.congestion_ratio,
           confidence = excluded.confidence,
           observed_at = excluded.observed_at
         WHERE excluded.observed_at >= traffic_aged.observed_at`,
        row.cell,
        row.segmentId,
        JSON.stringify(row.coordinates),
        row.source,
        row.currentSpeedMph,
        row.freeFlowSpeedMph,
        row.congestionRatio,
        row.confidence,
        row.observedAt,
      );
    }
  }

  async getByCells(cells: string[], minObservedAt: number): Promise<AgedTrafficRow[]> {
    if (cells.length === 0) return [];
    const db = await this.db();
    const placeholders = cells.map(() => '?').join(',');
    const rows = await db.getAllAsync<Row>(
      `SELECT cell, segment_id, coordinates, source, current_speed_mph,
              free_flow_speed_mph, congestion_ratio, confidence, observed_at
       FROM traffic_aged
       WHERE cell IN (${placeholders}) AND observed_at >= ?
       ORDER BY observed_at DESC`,
      ...cells,
      minObservedAt,
    );
    const out: AgedTrafficRow[] = [];
    for (const row of rows) {
      const coordinates = parseCoordinates(row.coordinates);
      if (!coordinates) continue; // corrupt row: drop rather than crash the cascade
      out.push({
        cell: row.cell,
        segmentId: row.segment_id,
        coordinates,
        source: row.source as NormalizedTrafficSegment['source'],
        currentSpeedMph: row.current_speed_mph,
        freeFlowSpeedMph: row.free_flow_speed_mph,
        congestionRatio: row.congestion_ratio,
        confidence: row.confidence,
        observedAt: row.observed_at,
      });
    }
    return out;
  }

  async deleteOlderThan(cutoff: number): Promise<number> {
    const db = await this.db();
    const before = await this.count();
    await db.runAsync(`DELETE FROM traffic_aged WHERE observed_at < ?`, cutoff);
    return Math.max(0, before - (await this.count()));
  }

  async enforceRowCap(maxRows: number): Promise<number> {
    const db = await this.db();
    const before = await this.count();
    if (before <= maxRows) return 0;
    await db.runAsync(
      `DELETE FROM traffic_aged WHERE rowid NOT IN (
         SELECT rowid FROM traffic_aged ORDER BY observed_at DESC LIMIT ?
       )`,
      maxRows,
    );
    return Math.max(0, before - (await this.count()));
  }

  async count(): Promise<number> {
    const db = await this.db();
    const row = await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM traffic_aged`);
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

function parseCoordinates(raw: string): [number, number][] | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const out: [number, number][] = [];
    for (const entry of parsed) {
      if (!Array.isArray(entry) || entry.length < 2) return null;
      const lng = Number(entry[0]);
      const lat = Number(entry[1]);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
      out.push([lng, lat]);
    }
    return out;
  } catch {
    return null;
  }
}
