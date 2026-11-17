import type { SavedFlowBackend, SavedFlowRow } from './trafficSavedFlowStore';
import type { NormalizedTrafficSegment, SavedFlowKind } from '../../models/traffic';

/**
 * SQLite backend for saved upstream flow (weekday × hour buckets).
 *
 * A separate database from the weekly probe index on purpose: this table holds
 * licensed upstream content, which must never be blended into (or republished
 * as) probe-derived history. See `trafficSavedFlowStore` for the policy.
 *
 * The table is new (`saved_flow`) rather than an evolution of the old
 * `traffic_aged` one: the key gained `day_of_week`, `hour` and `kind`, so old
 * rows cannot be reinterpreted under the new rule — and the old rows were
 * single-observation, hour-agnostic data that the new key would misattribute.
 * Any leftover `traffic_aged` table is dropped at init.
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
  day_of_week: number;
  hour: number;
  kind: string;
  segment_id: string;
  coordinates: string;
  source: string;
  current_speed_mph: number;
  free_flow_speed_mph: number;
  congestion_ratio: number;
  confidence: number;
  observed_at: number;
}

const SELECT_COLUMNS = `cell, day_of_week, hour, kind, segment_id, coordinates, source,
              current_speed_mph, free_flow_speed_mph, congestion_ratio, confidence, observed_at`;

export class SqliteSavedFlowBackend implements SavedFlowBackend {
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
      CREATE TABLE IF NOT EXISTS saved_flow (
        cell TEXT NOT NULL,
        day_of_week INTEGER NOT NULL,
        hour INTEGER NOT NULL,
        kind TEXT NOT NULL,
        segment_id TEXT NOT NULL,
        coordinates TEXT NOT NULL,
        source TEXT NOT NULL,
        current_speed_mph REAL NOT NULL,
        free_flow_speed_mph REAL NOT NULL,
        congestion_ratio REAL NOT NULL,
        confidence REAL NOT NULL,
        observed_at INTEGER NOT NULL,
        PRIMARY KEY (cell, day_of_week, hour, kind, segment_id)
      );
      CREATE INDEX IF NOT EXISTS idx_saved_flow_bucket
        ON saved_flow(day_of_week, hour, cell);
      CREATE INDEX IF NOT EXISTS idx_saved_flow_observed
        ON saved_flow(observed_at);
      DROP TABLE IF EXISTS traffic_aged;
    `);
  }

  async upsert(rows: SavedFlowRow[]): Promise<void> {
    if (rows.length === 0) return;
    const db = await this.db();
    for (const row of rows) {
      await db.runAsync(
        `INSERT INTO saved_flow
          (cell, day_of_week, hour, kind, segment_id, coordinates, source,
           current_speed_mph, free_flow_speed_mph, congestion_ratio, confidence, observed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(cell, day_of_week, hour, kind, segment_id) DO UPDATE SET
           coordinates = excluded.coordinates,
           source = excluded.source,
           current_speed_mph = excluded.current_speed_mph,
           free_flow_speed_mph = excluded.free_flow_speed_mph,
           congestion_ratio = excluded.congestion_ratio,
           confidence = excluded.confidence,
           observed_at = excluded.observed_at
         WHERE excluded.observed_at >= saved_flow.observed_at`,
        row.cell,
        row.dayOfWeek,
        row.hour,
        row.kind,
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

  async getByBucket(
    cells: string[],
    dayOfWeek: number,
    hour: number,
    kinds: SavedFlowKind[],
    minObservedAt: number,
  ): Promise<SavedFlowRow[]> {
    if (cells.length === 0 || kinds.length === 0) return [];
    const db = await this.db();
    const cellPlaceholders = cells.map(() => '?').join(',');
    const kindPlaceholders = kinds.map(() => '?').join(',');
    const rows = await db.getAllAsync<Row>(
      `SELECT ${SELECT_COLUMNS}
       FROM saved_flow
       WHERE cell IN (${cellPlaceholders})
         AND day_of_week = ? AND hour = ?
         AND kind IN (${kindPlaceholders})
         AND observed_at >= ?
       ORDER BY observed_at DESC`,
      ...cells,
      dayOfWeek,
      hour,
      ...kinds,
      minObservedAt,
    );
    const out: SavedFlowRow[] = [];
    for (const row of rows) {
      const coordinates = parseCoordinates(row.coordinates);
      if (!coordinates) continue; // corrupt row: drop rather than crash the cascade
      out.push({
        cell: row.cell,
        dayOfWeek: row.day_of_week,
        hour: row.hour,
        kind: row.kind === 'tile' ? 'tile' : 'segment',
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
    await db.runAsync(`DELETE FROM saved_flow WHERE observed_at < ?`, cutoff);
    return Math.max(0, before - (await this.count()));
  }

  async enforceRowCap(maxRows: number): Promise<number> {
    const db = await this.db();
    const before = await this.count();
    if (before <= maxRows) return 0;
    await db.runAsync(
      `DELETE FROM saved_flow WHERE rowid NOT IN (
         SELECT rowid FROM saved_flow ORDER BY observed_at DESC LIMIT ?
       )`,
      maxRows,
    );
    return Math.max(0, before - (await this.count()));
  }

  async count(): Promise<number> {
    const db = await this.db();
    const row = await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM saved_flow`);
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
