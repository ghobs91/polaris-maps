/**
 * On-device OSM POI index (Tier 0 of the Overpass replacement).
 *
 * Overpass is a *query service* over OpenStreetMap. Almost every query the app
 * issues is one of a handful of fixed shapes — "named POIs in this bbox whose
 * primary tag is in this set" — so the answer can be computed at pack build
 * time and shipped with the region, instead of asked of a stranger's server
 * every time the user pans the map.
 *
 * This module owns those tables and the query that replaces Overpass for the
 * covered area:
 *
 *   osm_pois          surrogate rowid, addressed by (osm_type, id)
 *   osm_pois_fts      FTS5 over name/subtype for text queries
 *   local_poi_coverage  one row per imported region, so callers can tell
 *                       "no POIs here" apart from "we have no data here"
 *   local_poi_shapes  which tag shapes a region's pack actually indexed, and
 *                       whether unnamed features are included. Without it the
 *                       only question answerable is "is this box covered?", so
 *                       a category with genuinely zero matches looks identical
 *                       to a tag the pack never indexed — and costs a network
 *                       request to find out. With it, "nothing here" is final.
 *
 * Rows come from a signed region pack (`search.sqlite`, produced by the pack
 * builder) via {@link importLocalPoiIndexFromPack}, or from the app's own OSM
 * edits via {@link upsertLocalPois}.
 *
 * Nothing here touches the network: a covered bbox is answered offline, with
 * no viewport leak to a third party.
 */

import * as SQLite from 'expo-sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { getDatabase } from '../database/init';
import { logDiagnostic } from '../diagnostics/diagnosticsLog';
import type { OsmPoi } from './osmFetcher';

/** DDL for the index tables. Idempotent; safe to run on every migration. */
export const LOCAL_POI_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS osm_pois (
    rowid INTEGER PRIMARY KEY AUTOINCREMENT,
    osm_type TEXT NOT NULL,
    osm_id INTEGER NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    primary_key TEXT NOT NULL,
    subtype TEXT NOT NULL,
    name TEXT NOT NULL,
    name_norm TEXT NOT NULL,
    tags_json TEXT NOT NULL,
    region_id TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL,
    UNIQUE (osm_type, osm_id)
  );
  CREATE INDEX IF NOT EXISTS idx_osm_pois_bounds ON osm_pois (lat, lng);
  CREATE INDEX IF NOT EXISTS idx_osm_pois_primary ON osm_pois (primary_key, subtype);
  CREATE INDEX IF NOT EXISTS idx_osm_pois_region ON osm_pois (region_id);

  CREATE VIRTUAL TABLE IF NOT EXISTS osm_pois_fts USING fts5(
    name,
    name_norm,
    subtype,
    content='osm_pois',
    content_rowid='rowid',
    tokenize='unicode61 remove_diacritics 2',
    prefix='2 3 4'
  );

  CREATE TRIGGER IF NOT EXISTS osm_pois_fts_insert AFTER INSERT ON osm_pois BEGIN
    INSERT INTO osm_pois_fts(rowid, name, name_norm, subtype)
      VALUES (NEW.rowid, NEW.name, NEW.name_norm, NEW.subtype);
  END;
  CREATE TRIGGER IF NOT EXISTS osm_pois_fts_delete AFTER DELETE ON osm_pois BEGIN
    INSERT INTO osm_pois_fts(osm_pois_fts, rowid, name, name_norm, subtype)
      VALUES ('delete', OLD.rowid, OLD.name, OLD.name_norm, OLD.subtype);
  END;
  CREATE TRIGGER IF NOT EXISTS osm_pois_fts_update AFTER UPDATE ON osm_pois BEGIN
    INSERT INTO osm_pois_fts(osm_pois_fts, rowid, name, name_norm, subtype)
      VALUES ('delete', OLD.rowid, OLD.name, OLD.name_norm, OLD.subtype);
    INSERT INTO osm_pois_fts(rowid, name, name_norm, subtype)
      VALUES (NEW.rowid, NEW.name, NEW.name_norm, NEW.subtype);
  END;

  CREATE TABLE IF NOT EXISTS local_poi_coverage (
    region_id TEXT PRIMARY KEY,
    south REAL NOT NULL,
    west REAL NOT NULL,
    north REAL NOT NULL,
    east REAL NOT NULL,
    poi_count INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  );

  -- Which query shapes this region's pack indexed. A value of '*' means "any
  -- value of this key"; named_only is 0 when unnamed features are included.
  CREATE TABLE IF NOT EXISTS local_poi_shapes (
    region_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    named_only INTEGER NOT NULL,
    poi_count INTEGER NOT NULL,
    PRIMARY KEY (region_id, key, value)
  );
`;

/** DDL for the pack-side copy of the index (no region_id: the importer adds it). */
export const PACK_POI_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS osm_pois (
    osm_type TEXT NOT NULL,
    osm_id INTEGER NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    primary_key TEXT NOT NULL,
    subtype TEXT NOT NULL,
    name TEXT NOT NULL,
    name_norm TEXT NOT NULL,
    tags_json TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (osm_type, osm_id)
  );
  CREATE INDEX IF NOT EXISTS idx_osm_pois_bounds ON osm_pois (lat, lng);
  CREATE INDEX IF NOT EXISTS idx_osm_pois_primary ON osm_pois (primary_key, subtype);

  CREATE TABLE IF NOT EXISTS poi_index_shapes (
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    named_only INTEGER NOT NULL,
    poi_count INTEGER NOT NULL,
    PRIMARY KEY (key, value)
  );
`;

/** Wildcard `value` in {@link PoiIndexShape}: every value of that key. */
export const POI_SHAPE_ANY_VALUE = '*';

/** A query shape a pack's POI index can answer. */
export interface PoiIndexShape {
  key: string;
  /** Tag value, or {@link POI_SHAPE_ANY_VALUE}. */
  value: string;
  /** True when the index only holds features that carry a name. */
  namedOnly: boolean;
  poiCount: number;
}

/** Bounding box, in degrees. Dateline-crossing boxes are not supported. */
export interface GeoBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** A primary-tag predicate: `amenity=restaurant`, or any `amenity`. */
export interface PoiKeyFilter {
  key: string;
  value?: string;
}

export interface LocalPoiQuery extends GeoBounds {
  /** Primary tag predicates, OR-ed together. Omit to match any POI. */
  keys?: readonly PoiKeyFilter[];
  /** Additional `tag=value` predicates, AND-ed onto the result. */
  tags?: ReadonlyArray<readonly [string, string]>;
  /** Free-text name query (prefix-tokenised against the FTS index). */
  namePattern?: string;
  /** Drop rows without a name (mirrors Overpass' `["name"]` filter). */
  requireName?: boolean;
  limit?: number;
}

export interface BuiltPoiQuery {
  sql: string;
  params: Array<string | number>;
}

/** SQL that answers "does any imported region cover this box?". */
export function buildPoiCoverageQuery(bounds: GeoBounds): BuiltPoiQuery {
  return {
    sql: `SELECT COUNT(*) AS covered
            FROM local_poi_coverage
           WHERE south <= ? AND north >= ? AND west <= ? AND east >= ? AND poi_count > 0`,
    params: [bounds.south, bounds.north, bounds.west, bounds.east],
  };
}

/** Does an indexed shape satisfy a requested filter at this name requirement? */
export function shapeSatisfiesFilter(
  shape: Pick<PoiIndexShape, 'key' | 'value' | 'namedOnly'>,
  filter: PoiKeyFilter,
  requireName: boolean,
): boolean {
  if (shape.key !== filter.key) return false;
  // A named-only shape cannot answer a query that wants unnamed features too.
  if (shape.namedOnly && !requireName) return false;
  if (shape.value === POI_SHAPE_ANY_VALUE) return true;
  return filter.value !== undefined && shape.value === filter.value;
}

/**
 * SQL that answers "does an imported region index every requested shape?".
 *
 * One `EXISTS` per filter, ANDed, so this is a single round trip. An empty
 * filter list degrades to the plain bbox check: any indexed POI will do.
 */
export function buildPoiShapeCoverageQuery(
  bounds: GeoBounds,
  keys: readonly PoiKeyFilter[],
  requireName: boolean,
): BuiltPoiQuery {
  if (keys.length === 0) return buildPoiCoverageQuery(bounds);

  const params: Array<string | number> = [];
  const clauses = keys.map((filter) => {
    params.push(bounds.south, bounds.north, bounds.west, bounds.east, filter.key);
    let valueClause: string;
    if (filter.value === undefined) {
      valueClause = 's.value = ?';
      params.push(POI_SHAPE_ANY_VALUE);
    } else {
      valueClause = '(s.value = ? OR s.value = ?)';
      params.push(POI_SHAPE_ANY_VALUE, filter.value);
    }
    params.push(requireName ? 1 : 0);
    return `EXISTS (SELECT 1
                     FROM local_poi_shapes s
                     JOIN local_poi_coverage c ON c.region_id = s.region_id
                    WHERE c.south <= ? AND c.north >= ? AND c.west <= ? AND c.east >= ?
                      AND c.poi_count > 0
                      AND s.key = ? AND ${valueClause}
                      AND (s.named_only = 0 OR ? = 1))`;
  });

  return {
    sql: `SELECT CASE WHEN ${clauses.map((clause) => `(${clause})`).join(' AND ')}
                THEN 1 ELSE 0 END AS covered`,
    params,
  };
}

const DEFAULT_LIMIT = 200;

/** Strip characters FTS5 would interpret, then turn words into prefix terms. */
export function ftsQueryFromText(text: string): string | null {
  const tokens = text
    .toLowerCase()
    .replace(/["'*()^:-]/g, ' ')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return null;
  return tokens.map((t, i) => (i === tokens.length - 1 ? `"${t}"*` : `"${t}"`)).join(' AND ');
}

/** JSON path for a tag key, quoted so `addr:street` and friends work. */
function jsonPathForTag(key: string): string {
  return `$."${key.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function centerOf(q: GeoBounds): { lat: number; lng: number } {
  return { lat: (q.south + q.north) / 2, lng: (q.west + q.east) / 2 };
}

/**
 * Build the SQL for a local POI query. Pure — the test suite runs it against a
 * real SQLite database without touching expo-sqlite.
 */
export function buildLocalPoiQuery(query: LocalPoiQuery): BuiltPoiQuery {
  const where: string[] = ['p.lat BETWEEN ? AND ?', 'p.lng BETWEEN ? AND ?'];
  const params: Array<string | number> = [query.south, query.north, query.west, query.east];

  let from = 'FROM osm_pois p';

  const keys = query.keys ?? [];
  if (keys.length > 0) {
    const clauses = keys.map((k) =>
      k.value === undefined ? 'p.primary_key = ?' : '(p.primary_key = ? AND p.subtype = ?)',
    );
    where.push(`(${clauses.join(' OR ')})`);
    for (const k of keys) {
      params.push(k.key);
      if (k.value !== undefined) params.push(k.value);
    }
  }

  for (const [key, value] of query.tags ?? []) {
    where.push('json_extract(p.tags_json, ?) = ?');
    params.push(jsonPathForTag(key), value);
  }

  if (query.requireName) where.push("p.name <> ''");

  const fts = query.namePattern ? ftsQueryFromText(query.namePattern) : null;
  if (fts) {
    from += ' JOIN osm_pois_fts ON osm_pois_fts.rowid = p.rowid';
    where.push('osm_pois_fts MATCH ?');
    params.push(fts);
  }

  const center = centerOf(query);
  const limit = Math.max(1, Math.min(query.limit ?? DEFAULT_LIMIT, 1000));

  const sql = [
    'SELECT p.osm_type, p.osm_id, p.lat, p.lng, p.primary_key, p.subtype, p.name, p.tags_json',
    from,
    `WHERE ${where.join(' AND ')}`,
    'ORDER BY (p.lat - ?) * (p.lat - ?) + (p.lng - ?) * (p.lng - ?)',
    'LIMIT ?',
  ].join('\n');

  params.push(center.lat, center.lat, center.lng, center.lng, limit);

  return { sql, params };
}

/** Single-row upsert shared by the edit path and the row-wise pack import. */
const POI_UPSERT_SQL = `
  INSERT INTO osm_pois
    (osm_type, osm_id, lat, lng, primary_key, subtype, name, name_norm, tags_json,
     region_id, version, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (osm_type, osm_id) DO UPDATE SET
    lat = excluded.lat,
    lng = excluded.lng,
    primary_key = excluded.primary_key,
    subtype = excluded.subtype,
    name = excluded.name,
    name_norm = excluded.name_norm,
    tags_json = excluded.tags_json,
    region_id = excluded.region_id,
    version = excluded.version,
    updated_at = excluded.updated_at
`;

/** Rows read per batch when importing without ATTACH (see importLocalPoiIndexFromPack). */
const PACK_IMPORT_BATCH = 500;

interface PoiRow {
  osm_type: string;
  osm_id: number;
  lat: number;
  lng: number;
  primary_key: string;
  subtype: string;
  name: string;
  name_norm: string;
  tags_json: string;
}

function rowToPoi(row: PoiRow): OsmPoi {
  let tags: Record<string, string> = {};
  try {
    const parsed: unknown = JSON.parse(row.tags_json);
    if (parsed && typeof parsed === 'object') tags = parsed as Record<string, string>;
  } catch {
    // Corrupt row: keep the geometry, drop the tags.
  }
  return {
    id: row.osm_id,
    lat: row.lat,
    lng: row.lng,
    name: row.name,
    type: row.primary_key,
    subtype: row.subtype,
    tags,
  };
}

let _schemaReady: Promise<void> | null = null;

/** Create the index tables once per process. */
export function ensureLocalPoiSchema(database?: SQLiteDatabase): Promise<void> {
  if (database) return database.execAsync(LOCAL_POI_SCHEMA_SQL);
  if (!_schemaReady) {
    _schemaReady = getDatabase()
      .then((db) => db.execAsync(LOCAL_POI_SCHEMA_SQL))
      .catch((err) => {
        _schemaReady = null;
        throw err;
      });
  }
  return _schemaReady;
}

/** Exposed for testing only. */
export function __resetLocalPoiSchemaCacheForTests(): void {
  _schemaReady = null;
}

/**
 * Query the on-device index. Returns `[]` when the index is empty — callers
 * must consult {@link hasLocalPoiCoverage} to distinguish "nothing here" from
 * "no data here".
 */
export async function queryLocalPois(query: LocalPoiQuery): Promise<OsmPoi[]> {
  await ensureLocalPoiSchema();
  const db = await getDatabase();
  const built = buildLocalPoiQuery(query);
  const rows = await db.getAllAsync<PoiRow>(built.sql, built.params);
  return rows.map(rowToPoi);
}

/** True when an imported region covers the whole box. */
export async function hasLocalPoiCoverage(bounds: GeoBounds): Promise<boolean> {
  await ensureLocalPoiSchema();
  const db = await getDatabase();
  const { sql, params } = buildPoiCoverageQuery(bounds);
  const row = await db.getFirstAsync<{ covered: number }>(sql, params);
  return (row?.covered ?? 0) > 0;
}

/**
 * True when every requested tag shape is indexed for this box — i.e. the pack
 * would have found a matching feature if one existed. Callers use this to treat
 * an empty local result as final instead of asking a third party.
 *
 * Returns false when the pack predates `poi_index_shapes` (no rows), which
 * degrades to the previous bbox-only behaviour rather than lying.
 */
export async function hasLocalPoiShapeCoverage(
  bounds: GeoBounds,
  keys: readonly PoiKeyFilter[],
  requireName: boolean,
): Promise<boolean> {
  if (keys.length === 0) return hasLocalPoiCoverage(bounds);
  await ensureLocalPoiSchema();
  const db = await getDatabase();
  const { sql, params } = buildPoiShapeCoverageQuery(bounds, keys, requireName);
  const row = await db.getFirstAsync<{ covered: number }>(sql, params);
  return (row?.covered ?? 0) > 0;
}

/** Shapes indexed for the region(s) covering a box (diagnostics and tests). */
export async function localPoiShapesForBounds(bounds: GeoBounds): Promise<PoiIndexShape[]> {
  await ensureLocalPoiSchema();
  const db = await getDatabase();
  const rows = await db.getAllAsync<{
    key: string;
    value: string;
    named_only: number;
    poi_count: number;
  }>(
    `SELECT DISTINCT s.key, s.value, s.named_only, s.poi_count
       FROM local_poi_shapes s
       JOIN local_poi_coverage c ON c.region_id = s.region_id
      WHERE c.south <= ? AND c.north >= ? AND c.west <= ? AND c.east >= ?`,
    [bounds.south, bounds.north, bounds.west, bounds.east],
  );
  return rows.map((row) => ({
    key: row.key,
    value: row.value,
    namedOnly: row.named_only !== 0,
    poiCount: row.poi_count,
  }));
}

/** Region ids whose coverage box contains the point (freshest first). */
export async function regionsCoveringPoint(
  lat: number,
  lng: number,
): Promise<Array<{ regionId: string; updatedAt: number }>> {
  await ensureLocalPoiSchema();
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ region_id: string; updated_at: number }>(
    `SELECT region_id, updated_at
       FROM local_poi_coverage
      WHERE south <= ? AND north >= ? AND west <= ? AND east >= ?
      ORDER BY updated_at DESC`,
    [lat, lat, lng, lng],
  );
  return rows.map((r) => ({ regionId: r.region_id, updatedAt: r.updated_at }));
}

function primaryKeyOf(tags: Record<string, string>): { key: string; subtype: string } {
  for (const key of ['amenity', 'shop', 'tourism', 'leisure', 'office', 'craft', 'healthcare']) {
    const value = tags[key];
    if (value) return { key, subtype: value };
  }
  return { key: 'amenity', subtype: 'place' };
}

/** Insert or replace POIs in the index (used for edits and pack imports). */
export async function upsertLocalPois(
  pois: ReadonlyArray<OsmPoi & { osmType?: 'node' | 'way' | 'relation' }>,
  regionId: string,
  version = 1,
): Promise<number> {
  if (pois.length === 0) return 0;
  await ensureLocalPoiSchema();
  const db = await getDatabase();
  const now = Date.now();

  await db.withTransactionAsync(async () => {
    for (const poi of pois) {
      const primary = primaryKeyOf(poi.tags ?? {});
      const key = poi.osmType ?? 'node';
      await db.runAsync(POI_UPSERT_SQL, [
        key,
        poi.id,
        poi.lat,
        poi.lng,
        poi.type || primary.key,
        poi.subtype || primary.subtype,
        poi.name,
        poi.name.toLowerCase(),
        JSON.stringify(poi.tags ?? {}),
        regionId,
        version,
        now,
      ]);
    }
  });

  return pois.length;
}

/** Record (or refresh) a region's coverage box after a successful import. */
export async function recordLocalPoiCoverage(
  regionId: string,
  bounds: GeoBounds,
  poiCount: number,
): Promise<void> {
  await ensureLocalPoiSchema();
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO local_poi_coverage (region_id, south, west, north, east, poi_count, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (region_id) DO UPDATE SET
       south = excluded.south,
       west = excluded.west,
       north = excluded.north,
       east = excluded.east,
       poi_count = excluded.poi_count,
       updated_at = excluded.updated_at`,
    [regionId, bounds.south, bounds.west, bounds.north, bounds.east, poiCount, Date.now()],
  );
}

/**
 * Import a region pack's `search.sqlite` into the local index.
 *
 * Fast path: attach the pack read-only and copy in a single transaction, so a
 * corrupt or truncated pack leaves the existing index untouched. Re-importing
 * the same region replaces its rows.
 *
 * Fallback: if ATTACH is unavailable or refused (some SQLite builds, sandboxed
 * file providers), read the pack through a second read-only connection and
 * upsert in batches — the same pattern the geocoding importer uses. Both paths
 * end in the same rows; only the throughput differs.
 *
 * Note on expo-sqlite (verified against 57.0.4 sources): `prepareStatement` is a
 * thin `sqlite3_prepare_v2` wrapper with no authorizer and no statement
 * allowlist, so ATTACH is permitted. The fallback exists for platforms where the
 * pack file is not attachable (scoped/URI file providers) and is exercised by
 * `__tests__/integration/localSearchIndexPipeline.test.ts`.
 */
export async function importLocalPoiIndexFromPack(
  packPath: string,
  regionId: string,
  bounds: GeoBounds,
): Promise<number> {
  await ensureLocalPoiSchema();
  const db = await getDatabase();

  let imported: number;
  try {
    imported = await importPoiRowsViaAttach(db, packPath, regionId);
  } catch (err) {
    logDiagnostic('poi', 'warn', 'pack POI attach import failed, importing row-wise', {
      regionId,
      error: err instanceof Error ? err.message : String(err),
    });
    imported = await importPoiRowsRowWise(packPath, regionId);
  }

  await recordLocalPoiCoverage(regionId, bounds, imported);
  return imported;
}

/** Does the attached pack carry shape metadata (packs built after v2 do)? */
async function packHasShapes(db: SQLiteDatabase): Promise<boolean> {
  const row = await db.getFirstAsync<{ name: string }>(
    `SELECT name FROM pack.sqlite_master WHERE type = 'table' AND name = 'poi_index_shapes'`,
  );
  return Boolean(row);
}

/** ATTACH + INSERT..SELECT: one statement, one transaction. */
async function importPoiRowsViaAttach(
  db: SQLiteDatabase,
  packPath: string,
  regionId: string,
): Promise<number> {
  await db.runAsync(`ATTACH DATABASE '${packPath.replace(/'/g, "''")}' AS pack`);
  try {
    // Older packs have no shape table: importing is then a no-op and the app
    // falls back to bbox-only coverage for that region.
    const withShapes = await packHasShapes(db);

    let imported = 0;
    await db.withTransactionAsync(async () => {
      await db.runAsync(
        `INSERT INTO osm_pois
           (osm_type, osm_id, lat, lng, primary_key, subtype, name, name_norm, tags_json, region_id, version, updated_at)
         SELECT osm_type, osm_id, lat, lng, primary_key, subtype, name, name_norm, tags_json, ?, version, updated_at
           FROM pack.osm_pois
         WHERE true
         ON CONFLICT (osm_type, osm_id) DO UPDATE SET
           lat = excluded.lat,
           lng = excluded.lng,
           primary_key = excluded.primary_key,
           subtype = excluded.subtype,
           name = excluded.name,
           name_norm = excluded.name_norm,
           tags_json = excluded.tags_json,
           region_id = excluded.region_id,
           version = excluded.version,
           updated_at = excluded.updated_at`,
        [regionId],
      );
      const count = await db.getFirstAsync<{ n: number }>(
        'SELECT COUNT(*) AS n FROM pack.osm_pois',
      );
      imported = count?.n ?? 0;

      if (withShapes) {
        await db.runAsync('DELETE FROM local_poi_shapes WHERE region_id = ?', [regionId]);
        await db.runAsync(
          `INSERT INTO local_poi_shapes (region_id, key, value, named_only, poi_count)
           SELECT ?, key, value, named_only, poi_count FROM pack.poi_index_shapes`,
          [regionId],
        );
      }
    });
    return imported;
  } finally {
    await db.runAsync('DETACH DATABASE pack').catch(() => undefined);
  }
}

/** Second connection + paged reads: works where ATTACH does not. */
async function importPoiRowsRowWise(packPath: string, regionId: string): Promise<number> {
  const packDb = await SQLite.openDatabaseAsync(packPath, {
    // The pack carries an FTS5-backed schema in some builds; see
    // database/init.ts (expo/expo#38168).
    finalizeUnusedStatementsBeforeClosing: false,
  });
  const db = await getDatabase();

  let offset = 0;
  let imported = 0;
  try {
    for (;;) {
      const rows = await packDb.getAllAsync<PoiRow & { version: number; updated_at: number }>(
        `SELECT osm_type, osm_id, lat, lng, primary_key, subtype, name, name_norm,
                tags_json, version, updated_at
           FROM osm_pois
          ORDER BY osm_type, osm_id
          LIMIT ? OFFSET ?`,
        [PACK_IMPORT_BATCH, offset],
      );
      if (rows.length === 0) break;

      await db.withTransactionAsync(async () => {
        for (const row of rows) {
          await db.runAsync(POI_UPSERT_SQL, [
            row.osm_type,
            row.osm_id,
            row.lat,
            row.lng,
            row.primary_key,
            row.subtype,
            row.name,
            row.name_norm,
            row.tags_json,
            regionId,
            row.version,
            row.updated_at,
          ]);
        }
      });

      imported += rows.length;
      offset += rows.length;
    }

    // Shape metadata, same source and same best-effort rule as the rows.
    const shapes = await packDb
      .getAllAsync<{
        key: string;
        value: string;
        named_only: number;
        poi_count: number;
      }>('SELECT key, value, named_only, poi_count FROM poi_index_shapes')
      .catch(() => []);
    await db.withTransactionAsync(async () => {
      await db.runAsync('DELETE FROM local_poi_shapes WHERE region_id = ?', [regionId]);
      for (const shape of shapes) {
        await db.runAsync(
          `INSERT INTO local_poi_shapes (region_id, key, value, named_only, poi_count)
           VALUES (?, ?, ?, ?, ?)`,
          [regionId, shape.key, shape.value, shape.named_only, shape.poi_count],
        );
      }
    });
  } finally {
    await packDb.closeAsync().catch(() => undefined);
  }

  return imported;
}

/** Drop a region's rows (region removal / free up space). */
export async function clearLocalPoiIndex(regionId: string): Promise<void> {
  await ensureLocalPoiSchema();
  const db = await getDatabase();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM osm_pois WHERE region_id = ?', [regionId]);
    await db.runAsync('DELETE FROM local_poi_shapes WHERE region_id = ?', [regionId]);
    await db.runAsync('DELETE FROM local_poi_coverage WHERE region_id = ?', [regionId]);
  });
}
