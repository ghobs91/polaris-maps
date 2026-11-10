/**
 * Pack-builder / app-schema drift guard.
 *
 * `scripts/osm-to-search-sqlite.py` embeds its own copy of the pack DDL, because
 * Python cannot import the TypeScript constants. If the two ever drift, the
 * importer (`packIndices` → `importLocalPoiIndexFromPack`) fails on device, and
 * it fails *silently* by design — pack index import is best-effort so a bad pack
 * degrades to network fallback instead of breaking a download.
 *
 * This test executes both DDLs in real SQLite and compares the resulting
 * columns, so drift is caught in CI rather than in the field.
 */

import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

jest.mock('expo-sqlite', () => ({}));
jest.mock('../../src/services/database/init', () => ({ getDatabase: jest.fn() }));

import { PACK_POI_SCHEMA_SQL } from '../../src/services/poi/localPoiIndex';
import { PACK_TRANSIT_SCHEMA_SQL } from '../../src/services/transit/localTransitIndex';

const BUILDER = resolve(__dirname, '../../scripts/osm-to-search-sqlite.py');

/** Extract a triple-quoted DDL constant from the Python builder. */
function pythonDdl(source: string, constant: string): string {
  const match = new RegExp(`${constant} = """([\\s\\S]*?)"""`).exec(source);
  if (!match) throw new Error(`DDL constant ${constant} not found in builder script`);
  return match[1]!;
}

interface Column {
  name: string;
  type: string;
  notnull: number;
  pk: number;
}

/** Columns of every table created by a DDL script, keyed by table name. */
function tableColumns(ddl: string): Record<string, Column[]> {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(ddl);
    const tables = db
      .prepare(
        `SELECT name FROM sqlite_master
          WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
          ORDER BY name`,
      )
      .all() as Array<{ name: string }>;

    const out: Record<string, Column[]> = {};
    for (const { name } of tables) {
      out[name] = (
        db.prepare(`PRAGMA table_info(${JSON.stringify(name)})`).all() as Array<{
          name: string;
          type: string;
          notnull: number;
          pk: number;
        }>
      ).map((column) => ({
        name: column.name,
        // SQLite reports declared types verbatim; normalise case so a typo in
        // casing is not treated as schema drift.
        type: column.type.toUpperCase(),
        notnull: column.notnull,
        pk: column.pk,
      }));
    }
    return out;
  } finally {
    db.close();
  }
}

const BUILDER_SOURCE = readFileSync(BUILDER, 'utf8');

describe('pack schema drift', () => {
  it('search.sqlite columns match PACK_POI_SCHEMA_SQL', () => {
    const builder = tableColumns(pythonDdl(BUILDER_SOURCE, 'POI_SCHEMA'));
    const app = tableColumns(PACK_POI_SCHEMA_SQL);

    expect(Object.keys(builder)).toEqual(['osm_pois']);
    expect(builder.osm_pois).toEqual(app.osm_pois);
  });

  it('transit.sqlite columns match PACK_TRANSIT_SCHEMA_SQL', () => {
    const builder = tableColumns(pythonDdl(BUILDER_SOURCE, 'TRANSIT_SCHEMA'));
    const app = tableColumns(PACK_TRANSIT_SCHEMA_SQL);

    expect(Object.keys(builder).sort()).toEqual([
      'osm_transit_route_stops',
      'osm_transit_routes',
      'osm_transit_stops',
    ]);
    for (const table of Object.keys(app)) {
      expect(builder[table]).toBeDefined();
      expect(builder[table]).toEqual(app[table]);
    }
  });

  it('the builder writes every column the importer selects', () => {
    // Mirrors the column list in importLocalPoiIndexFromPack / the transit
    // importer: a builder that omits one of these makes the INSERT..SELECT fail.
    const poi = tableColumns(pythonDdl(BUILDER_SOURCE, 'POI_SCHEMA')).osm_pois!.map(
      (column) => column.name,
    );
    expect(poi).toEqual(
      expect.arrayContaining([
        'osm_type',
        'osm_id',
        'lat',
        'lng',
        'primary_key',
        'subtype',
        'name',
        'name_norm',
        'tags_json',
        'version',
        'updated_at',
      ]),
    );
  });
});
