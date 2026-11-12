import * as SQLite from 'expo-sqlite';

let db: SQLite.SQLiteDatabase | null = null;

// Column definitions for the `reviews` table, shared by the fresh-install DDL
// and the foreign-key removal migration.
//
// NOTE: `poi_uuid` intentionally has no foreign key. Reviews can target places
// that are not in the local `places` cache (e.g. an OSM POI opened straight
// from the map, identified as `osm:node/123`); the local place table is a
// cache, not the source of truth, so requiring a parent row would reject valid
// reviews.
const REVIEWS_TABLE_COLUMNS = `
  id TEXT PRIMARY KEY,
  poi_uuid TEXT NOT NULL,
  author_pubkey TEXT NOT NULL,
  rating INTEGER NOT NULL,
  text TEXT,
  signature TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'anonymous',
  atproto_uri TEXT,
  author_handle TEXT
`;

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  db = await SQLite.openDatabaseAsync('polaris-maps.db', {
    // expo-sqlite's pre-close "finalize unused statements" walk also finalizes
    // the persistent statements owned by virtual tables (FTS5 here), which
    // SQLite then finalizes a second time in sqlite3_close — a use-after-free
    // that crashes in sqlite3Fts5IndexClose. Disable the walk; the app always
    // finalizes the statements it prepares. See expo/expo#38168.
    finalizeUnusedStatementsBeforeClosing: false,
  });
  await initializeSchema(db);
  return db;
}

async function initializeSchema(database: SQLite.SQLiteDatabase): Promise<void> {
  await database.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS regions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      bounds_min_lat REAL NOT NULL,
      bounds_max_lat REAL NOT NULL,
      bounds_min_lng REAL NOT NULL,
      bounds_max_lng REAL NOT NULL,
      version TEXT NOT NULL,
      download_status TEXT NOT NULL DEFAULT 'none',
      tiles_size_bytes INTEGER,
      routing_size_bytes INTEGER,
      geocoding_size_bytes INTEGER,
      downloaded_at INTEGER,
      last_updated INTEGER,
      drive_key TEXT
    );

    CREATE TABLE IF NOT EXISTS map_tiles (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      z INTEGER NOT NULL,
      x INTEGER NOT NULL,
      y INTEGER NOT NULL,
      byte_offset INTEGER NOT NULL,
      byte_length INTEGER NOT NULL,
      cached_at INTEGER NOT NULL,
      last_accessed INTEGER NOT NULL,
      file_path TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_map_tiles_zxy ON map_tiles (z, x, y);
    CREATE INDEX IF NOT EXISTS idx_map_tiles_source ON map_tiles (source_id);
    CREATE INDEX IF NOT EXISTS idx_map_tiles_lru ON map_tiles (last_accessed);

    CREATE TABLE IF NOT EXISTS road_segments (
      segment_id TEXT PRIMARY KEY,
      geohash6 TEXT NOT NULL,
      way_id TEXT,
      road_class TEXT NOT NULL,
      speed_limit_mph INTEGER,
      is_oneway INTEGER NOT NULL DEFAULT 0,
      start_lat REAL NOT NULL,
      start_lng REAL NOT NULL,
      end_lat REAL NOT NULL,
      end_lng REAL NOT NULL,
      region_id TEXT NOT NULL,
      FOREIGN KEY (region_id) REFERENCES regions(id)
    );
    CREATE INDEX IF NOT EXISTS idx_road_segments_geohash ON road_segments (geohash6);
    CREATE INDEX IF NOT EXISTS idx_road_segments_region ON road_segments (region_id);

    CREATE VIRTUAL TABLE IF NOT EXISTS geocoding_entries USING fts5(
      text,
      type,
      housenumber,
      street,
      city,
      state,
      postcode,
      country,
      content='geocoding_data'
    );

    CREATE TABLE IF NOT EXISTS geocoding_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      type TEXT NOT NULL,
      housenumber TEXT,
      street TEXT,
      city TEXT,
      state TEXT,
      postcode TEXT,
      country TEXT,
      lat REAL NOT NULL,
      lng REAL NOT NULL
    );

    -- ── Unified search index ───────────────────────────────────────────
    -- One ranked document table behind BOTH place search and address
    -- geocoding. The places and geocoding_data tables stay the data stores;
    -- this is the single index the query layer reads, so a search never has
    -- to merge two independently-ranked FTS result sets.
    CREATE TABLE IF NOT EXISTS search_docs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_key TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL,
      name TEXT,
      brand TEXT,
      category TEXT,
      housenumber TEXT,
      street TEXT,
      city TEXT,
      state TEXT,
      postcode TEXT,
      country TEXT,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      importance REAL NOT NULL DEFAULT 0,
      interpolated INTEGER NOT NULL DEFAULT 0,
      region_id TEXT,
      ref_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_search_docs_bounds ON search_docs (lat, lng);
    CREATE INDEX IF NOT EXISTS idx_search_docs_kind ON search_docs (kind);

    CREATE TABLE IF NOT EXISTS route_history (
      id TEXT PRIMARY KEY,
      origin_lat REAL NOT NULL,
      origin_lng REAL NOT NULL,
      origin_name TEXT,
      destination_lat REAL NOT NULL,
      destination_lng REAL NOT NULL,
      destination_name TEXT,
      mode TEXT NOT NULL,
      distance_meters INTEGER NOT NULL,
      duration_seconds INTEGER NOT NULL,
      route_geometry TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS peer_node (
      pubkey TEXT PRIMARY KEY,
      region_ids TEXT NOT NULL DEFAULT '[]',
      cache_size_bytes INTEGER NOT NULL DEFAULT 0,
      data_served_bytes INTEGER NOT NULL DEFAULT 0,
      peer_connections INTEGER NOT NULL DEFAULT 0,
      uptime_seconds INTEGER NOT NULL DEFAULT 0,
      first_seen INTEGER NOT NULL,
      last_active INTEGER NOT NULL,
      resource_limit_storage_mb INTEGER NOT NULL DEFAULT 500,
      resource_limit_bandwidth_mbps REAL NOT NULL DEFAULT 5.0,
      resource_limit_battery_pct_hr REAL NOT NULL DEFAULT 5.0
    );

    CREATE TABLE IF NOT EXISTS places (
      uuid TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      geohash8 TEXT NOT NULL,
      address_street TEXT,
      address_city TEXT,
      address_state TEXT,
      address_postcode TEXT,
      address_country TEXT,
      phone TEXT,
      website TEXT,
      yelp TEXT,
      social_media TEXT,
      emails TEXT,
      brand_name TEXT,
      hours TEXT,
      avg_rating REAL,
      review_count INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open',
      source TEXT NOT NULL,
      author_pubkey TEXT,
      signature TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_places_geohash ON places (geohash8);
    CREATE INDEX IF NOT EXISTS idx_places_category ON places (category, geohash8);
    CREATE INDEX IF NOT EXISTS idx_places_author ON places (author_pubkey);
    CREATE INDEX IF NOT EXISTS idx_places_name ON places (name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_places_brand ON places (brand_name COLLATE NOCASE);
    -- Viewport place lookup (getPlacesInBounds). The equality on status
    -- leads so SQLite seeks straight into the lat range instead of scanning
    -- the whole table; lng is applied as a residual filter.
    CREATE INDEX IF NOT EXISTS idx_places_bounds ON places (status, lat, lng);

    CREATE VIRTUAL TABLE IF NOT EXISTS places_fts USING fts5(
      name,
      brand_name,
      category,
      address_city,
      content='places',
      content_rowid='rowid',
      tokenize='unicode61 remove_diacritics 2',
      prefix='2 3 4'
    );

    -- Triggers to keep places_fts in sync with the places table
    CREATE TRIGGER IF NOT EXISTS places_fts_insert AFTER INSERT ON places BEGIN
      INSERT INTO places_fts(rowid, name, brand_name, category, address_city)
        VALUES (NEW.rowid, NEW.name, NEW.brand_name, NEW.category, NEW.address_city);
    END;
    CREATE TRIGGER IF NOT EXISTS places_fts_delete AFTER DELETE ON places BEGIN
      INSERT INTO places_fts(places_fts, rowid, name, brand_name, category, address_city)
        VALUES ('delete', OLD.rowid, OLD.name, OLD.brand_name, OLD.category, OLD.address_city);
    END;
    CREATE TRIGGER IF NOT EXISTS places_fts_update AFTER UPDATE ON places BEGIN
      INSERT INTO places_fts(places_fts, rowid, name, brand_name, category, address_city)
        VALUES ('delete', OLD.rowid, OLD.name, OLD.brand_name, OLD.category, OLD.address_city);
      INSERT INTO places_fts(rowid, name, brand_name, category, address_city)
        VALUES (NEW.rowid, NEW.name, NEW.brand_name, NEW.category, NEW.address_city);
    END;

    CREATE TABLE IF NOT EXISTS reviews (${REVIEWS_TABLE_COLUMNS});
    CREATE INDEX IF NOT EXISTS idx_reviews_poi ON reviews (poi_uuid, created_at DESC);

    CREATE TABLE IF NOT EXISTS review_media (
      review_id TEXT NOT NULL,
      hash TEXT NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      mime TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'local',
      created_at INTEGER NOT NULL,
      PRIMARY KEY (review_id, hash),
      FOREIGN KEY (review_id) REFERENCES reviews(id)
    );
    CREATE INDEX IF NOT EXISTS idx_review_media_review ON review_media (review_id);

    CREATE TABLE IF NOT EXISTS review_helpful (
      review_id TEXT NOT NULL,
      voter_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (review_id, voter_id),
      FOREIGN KEY (review_id) REFERENCES reviews(id)
    );
    CREATE INDEX IF NOT EXISTS idx_review_helpful_review ON review_helpful (review_id);

    CREATE TABLE IF NOT EXISTS street_imagery (
      id TEXT PRIMARY KEY,
      author_pubkey TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      geohash8 TEXT NOT NULL,
      bearing INTEGER NOT NULL,
      captured_at INTEGER NOT NULL,
      image_hash TEXT NOT NULL,
      hypercore_feed_key TEXT NOT NULL,
      feed_seq INTEGER NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      blurred INTEGER NOT NULL DEFAULT 0,
      signature TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_imagery_geohash ON street_imagery (geohash8, bearing);
    CREATE INDEX IF NOT EXISTS idx_imagery_author ON street_imagery (author_pubkey);

    -- Street-imagery contribution queue (Mapillary). Separate from the P2P
    -- street_imagery table above; these rows are external uploads.
    CREATE TABLE IF NOT EXISTS streetview_drives (
      id TEXT PRIMARY KEY,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      status TEXT NOT NULL DEFAULT 'recording',
      capture_count INTEGER NOT NULL DEFAULT 0,
      bytes INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_streetview_drives_status
      ON streetview_drives (status, created_at DESC);

    CREATE TABLE IF NOT EXISTS streetview_captures (
      id TEXT PRIMARY KEY,
      drive_id TEXT NOT NULL,
      local_uri TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      altitude REAL,
      heading REAL,
      speed_mps REAL,
      captured_at INTEGER NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      bytes INTEGER NOT NULL DEFAULT 0,
      image_hash TEXT,
      blurred INTEGER NOT NULL DEFAULT 0,
      stream TEXT NOT NULL DEFAULT 'wide',
      pair_id TEXT,
      mapillary_status TEXT NOT NULL DEFAULT 'pending',
      mapillary_file_handle TEXT,
      mapillary_image_id TEXT,
      error TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_streetview_captures_drive
      ON streetview_captures (drive_id, captured_at);

    CREATE TABLE IF NOT EXISTS streetview_uploads (
      id TEXT PRIMARY KEY,
      drive_id TEXT NOT NULL,
      target TEXT NOT NULL,
      remote_batch_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      total INTEGER NOT NULL DEFAULT 0,
      uploaded INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE (drive_id, target)
    );
    CREATE INDEX IF NOT EXISTS idx_streetview_uploads_drive
      ON streetview_uploads (drive_id);

    CREATE TABLE IF NOT EXISTS dashcam_clips (
      id TEXT PRIMARY KEY,
      local_uri TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      bytes INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_dashcam_clips_started
      ON dashcam_clips (started_at DESC);

    CREATE TABLE IF NOT EXISTS place_detail_cache (
      canonical_id TEXT PRIMARY KEY,
      place_id TEXT,
      osm_id TEXT,
      name TEXT NOT NULL DEFAULT '',
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      snapshot TEXT NOT NULL,
      media TEXT,
      reviews TEXT,
      source_version INTEGER NOT NULL DEFAULT 1,
      cached_at INTEGER NOT NULL,
      last_accessed INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_place_detail_osm ON place_detail_cache (osm_id);
    CREATE INDEX IF NOT EXISTS idx_place_detail_lru ON place_detail_cache (last_accessed);
  `);

  // Migrations for existing databases
  try {
    await database.execAsync(`ALTER TABLE regions ADD COLUMN drive_key TEXT`);
  } catch {
    // Column already exists
  }
  for (const col of ['pmtiles_tx_id', 'routing_graph_tx_id', 'geocoding_db_tx_id']) {
    try {
      await database.execAsync(`ALTER TABLE regions DROP COLUMN ${col}`);
    } catch {
      // Column already removed or never existed
    }
  }

  // Add Overture-enriched columns if this is an existing database
  for (const ddl of [
    `ALTER TABLE places ADD COLUMN brand_name TEXT`,
    `ALTER TABLE places ADD COLUMN social_media TEXT`,
    `ALTER TABLE places ADD COLUMN emails TEXT`,
    `ALTER TABLE places ADD COLUMN yelp TEXT`,
  ]) {
    try {
      await database.execAsync(ddl);
    } catch {
      // Column already exists
    }
  }

  // Detail-stream columns for the street-imagery queue.
  for (const ddl of [
    `ALTER TABLE streetview_captures ADD COLUMN stream TEXT NOT NULL DEFAULT 'wide'`,
    `ALTER TABLE streetview_captures ADD COLUMN pair_id TEXT`,
  ]) {
    await database.execAsync(ddl).catch(() => {});
  }

  // Add region_id to geocoding_data for per-region cascade deletes
  await database.execAsync(`ALTER TABLE geocoding_data ADD COLUMN region_id TEXT;`).catch(() => {});

  // Add geocoding_url to regions for per-region geocoding bundle URL
  await database.execAsync(`ALTER TABLE regions ADD COLUMN geocoding_url TEXT;`).catch(() => {});

  // Add tile_version to regions for version-aware P2P downloads
  await database.execAsync(`ALTER TABLE regions ADD COLUMN tile_version TEXT;`).catch(() => {});

  // Add places_url / places_size_bytes to regions for the Overture places
  // bundle (offline viewport POIs).
  await database.execAsync(`ALTER TABLE regions ADD COLUMN places_url TEXT;`).catch(() => {});
  await database
    .execAsync(`ALTER TABLE regions ADD COLUMN places_size_bytes INTEGER;`)
    .catch(() => {});

  // ATProto review columns
  for (const ddl of [
    `ALTER TABLE reviews ADD COLUMN source TEXT NOT NULL DEFAULT 'anonymous'`,
    `ALTER TABLE reviews ADD COLUMN atproto_uri TEXT`,
    `ALTER TABLE reviews ADD COLUMN author_handle TEXT`,
  ]) {
    try {
      await database.execAsync(ddl);
    } catch {
      // Column already exists
    }
  }

  await migrateReviewsForeignKey(database);
  await migrateSearchIndexes(database);
  await migrateUnifiedSearchIndex(database);
  await migrateGeocodingRtree(database);
}

/**
 * Drop the legacy `reviews.poi_uuid → places(uuid)` foreign key.
 *
 * Older databases created `reviews` with that constraint, which rejects
 * reviews for POIs that are not in the local `places` cache (e.g. an OSM POI
 * identified as `osm:node/123`). SQLite cannot drop a constraint in place, so
 * the table is rebuilt. `legacy_alter_table` is enabled during the rebuild so
 * the rename does not rewrite the `review_media`/`review_helpful` foreign keys
 * to point at the temporary table.
 */
async function migrateReviewsForeignKey(database: SQLite.SQLiteDatabase): Promise<void> {
  const row = await database.getFirstAsync<{ sql: string | null }>(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'reviews'",
  );
  if (!row?.sql || !row.sql.includes('REFERENCES places')) return;

  await database.execAsync('PRAGMA foreign_keys = OFF');
  await database.execAsync('PRAGMA legacy_alter_table = ON');
  try {
    await database.execAsync(`
      BEGIN;
      ALTER TABLE reviews RENAME TO reviews_fk_legacy;
      CREATE TABLE reviews (${REVIEWS_TABLE_COLUMNS});
      INSERT INTO reviews (
        id, poi_uuid, author_pubkey, rating, text, signature, created_at, updated_at,
        source, atproto_uri, author_handle
      )
      SELECT
        id, poi_uuid, author_pubkey, rating, text, signature, created_at, updated_at,
        source, atproto_uri, author_handle
      FROM reviews_fk_legacy;
      DROP TABLE reviews_fk_legacy;
      CREATE INDEX IF NOT EXISTS idx_reviews_poi ON reviews (poi_uuid, created_at DESC);
      COMMIT;
    `);
  } catch (err) {
    await database.execAsync('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await database.execAsync('PRAGMA legacy_alter_table = OFF').catch(() => {});
    await database.execAsync('PRAGMA foreign_keys = ON').catch(() => {});
  }
}

const PLACES_FTS_TRIGGERS = `
  CREATE TRIGGER IF NOT EXISTS places_fts_insert AFTER INSERT ON places BEGIN
    INSERT INTO places_fts(rowid, name, brand_name, category, address_city)
      VALUES (NEW.rowid, NEW.name, NEW.brand_name, NEW.category, NEW.address_city);
  END;
  CREATE TRIGGER IF NOT EXISTS places_fts_delete AFTER DELETE ON places BEGIN
    INSERT INTO places_fts(places_fts, rowid, name, brand_name, category, address_city)
      VALUES ('delete', OLD.rowid, OLD.name, OLD.brand_name, OLD.category, OLD.address_city);
  END;
  CREATE TRIGGER IF NOT EXISTS places_fts_update AFTER UPDATE ON places BEGIN
    INSERT INTO places_fts(places_fts, rowid, name, brand_name, category, address_city)
      VALUES ('delete', OLD.rowid, OLD.name, OLD.brand_name, OLD.category, OLD.address_city);
    INSERT INTO places_fts(rowid, name, brand_name, category, address_city)
      VALUES (NEW.rowid, NEW.name, NEW.brand_name, NEW.category, NEW.address_city);
  END;
`;

/**
 * Idempotent search-index migrations.
 *
 * - `places_fts` gains prefix indexes (`prefix='2 3 4'`) so short autocomplete
 *   prefixes don't need a full scan. Detected from `sqlite_master`, so the
 *   migration runs exactly once per database.
 * - `geocoding_trigram` provides offline typo/substring matching for street
 *   and locality names, created from the existing content table.
 */
async function migrateSearchIndexes(database: SQLite.SQLiteDatabase): Promise<void> {
  const placesFts = await database.getFirstAsync<{ sql: string | null }>(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'places_fts'",
  );
  if (placesFts && (placesFts.sql ?? '').length > 0 && !(placesFts.sql ?? '').includes('prefix=')) {
    await database.execAsync(`
      DROP TRIGGER IF EXISTS places_fts_insert;
      DROP TRIGGER IF EXISTS places_fts_delete;
      DROP TRIGGER IF EXISTS places_fts_update;
      DROP TABLE IF EXISTS places_fts;
      CREATE VIRTUAL TABLE places_fts USING fts5(
        name,
        brand_name,
        category,
        address_city,
        content='places',
        content_rowid='rowid',
        tokenize='unicode61 remove_diacritics 2',
        prefix='2 3 4'
      );
      INSERT INTO places_fts(places_fts) VALUES('rebuild');
      ${PLACES_FTS_TRIGGERS}
    `);
  }

  const trigram = await database.getFirstAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'geocoding_trigram'",
  );
  if (!trigram) {
    await database.execAsync(`
      CREATE VIRTUAL TABLE geocoding_trigram USING fts5(
        text,
        street,
        city,
        content='geocoding_data',
        content_rowid='id',
        tokenize='trigram'
      );
      INSERT INTO geocoding_trigram(geocoding_trigram) VALUES('rebuild');
      CREATE TRIGGER IF NOT EXISTS geocoding_trigram_insert AFTER INSERT ON geocoding_data BEGIN
        INSERT INTO geocoding_trigram(rowid, text, street, city)
          VALUES (NEW.id, NEW.text, NEW.street, NEW.city);
      END;
      CREATE TRIGGER IF NOT EXISTS geocoding_trigram_delete AFTER DELETE ON geocoding_data BEGIN
        INSERT INTO geocoding_trigram(geocoding_trigram, rowid, text, street, city)
          VALUES ('delete', OLD.id, OLD.text, OLD.street, OLD.city);
      END;
      CREATE TRIGGER IF NOT EXISTS geocoding_trigram_update AFTER UPDATE ON geocoding_data BEGIN
        INSERT INTO geocoding_trigram(geocoding_trigram, rowid, text, street, city)
          VALUES ('delete', OLD.id, OLD.text, OLD.street, OLD.city);
        INSERT INTO geocoding_trigram(rowid, text, street, city)
          VALUES (NEW.id, NEW.text, NEW.street, NEW.city);
      END;
    `);
  }
}

/**
 * Unified search index: one FTS5 document table behind place search *and*
 * address geocoding.
 *
 * `places` and `geocoding_data` remain the data stores; `search_docs` is the
 * only thing the query layer ranks. Triggers keep it in sync on both write
 * paths (Overture import, region-pack import), so a caller never has to
 * remember to index. The backfill runs exactly once on databases created
 * before this index existed — `search_docs` being non-empty means the triggers
 * have taken over.
 */
async function migrateUnifiedSearchIndex(database: SQLite.SQLiteDatabase): Promise<void> {
  await database.execAsync(SEARCH_DOCS_DDL);

  const existing = await database.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM search_docs',
  );
  if ((existing?.n ?? 0) > 0) return;

  // Backfill from whichever stores already have rows. `INSERT OR IGNORE`
  // keeps the unique doc_key honest if a trigger already fired mid-migration.
  await database.execAsync(`
    INSERT OR IGNORE INTO search_docs (
      doc_key, kind, name, brand, category, housenumber, street, city, state,
      postcode, country, lat, lng, importance, interpolated, ref_id
    )
    SELECT
      'place:' || uuid, 'poi', name, brand_name, category, NULL, address_street,
      address_city, address_state, address_postcode, address_country,
      lat, lng, COALESCE(review_count, 0) / 50.0, 0, uuid
    FROM places;

    INSERT OR IGNORE INTO search_docs (
      doc_key, kind, name, brand, category, housenumber, street, city, state,
      postcode, country, lat, lng, importance, interpolated, region_id, ref_id
    )
    SELECT
      'geo:' || id,
      CASE
        WHEN type = 'city' THEN 'locality'
        WHEN type = 'place' THEN 'admin'
        ELSE 'address'
      END,
      text, NULL, NULL, housenumber, street, city, state, postcode, country,
      lat, lng,
      CASE
        WHEN type = 'city' THEN 3.0
        WHEN type = 'place' THEN 2.0
        WHEN type = 'address_interpolated' THEN 0.5
        ELSE 1.0
      END,
      CASE WHEN type = 'address_interpolated' THEN 1 ELSE 0 END,
      region_id, CAST(id AS TEXT)
    FROM geocoding_data;

    INSERT INTO search_docs_fts(search_docs_fts) VALUES('rebuild');
    INSERT INTO search_docs_trigram(search_docs_trigram) VALUES('rebuild');
  `);
}

/** Content table, both FTS projections, and the four trigger families that
 *  keep them consistent. Idempotent, so it doubles as the migration. Exported
 *  for the schema regression suite, which runs it against node:sqlite. */
export const SEARCH_DOCS_DDL = `
  CREATE TABLE IF NOT EXISTS search_docs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_key TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    name TEXT,
    brand TEXT,
    category TEXT,
    housenumber TEXT,
    street TEXT,
    city TEXT,
    state TEXT,
    postcode TEXT,
    country TEXT,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    importance REAL NOT NULL DEFAULT 0,
    interpolated INTEGER NOT NULL DEFAULT 0,
    region_id TEXT,
    ref_id TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_search_docs_bounds ON search_docs (lat, lng);
  CREATE INDEX IF NOT EXISTS idx_search_docs_kind ON search_docs (kind);

  CREATE VIRTUAL TABLE IF NOT EXISTS search_docs_fts USING fts5(
    name,
    brand,
    category,
    street,
    city,
    housenumber,
    content='search_docs',
    content_rowid='id',
    tokenize='unicode61 remove_diacritics 2',
    prefix='2 3 4'
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS search_docs_trigram USING fts5(
    name,
    street,
    city,
    content='search_docs',
    content_rowid='id',
    tokenize='trigram'
  );

  CREATE TRIGGER IF NOT EXISTS search_docs_fts_insert AFTER INSERT ON search_docs BEGIN
    INSERT INTO search_docs_fts(rowid, name, brand, category, street, city, housenumber)
      VALUES (NEW.id, NEW.name, NEW.brand, NEW.category, NEW.street, NEW.city, NEW.housenumber);
    INSERT INTO search_docs_trigram(rowid, name, street, city)
      VALUES (NEW.id, NEW.name, NEW.street, NEW.city);
  END;

  CREATE TRIGGER IF NOT EXISTS search_docs_fts_delete AFTER DELETE ON search_docs BEGIN
    INSERT INTO search_docs_fts(search_docs_fts, rowid, name, brand, category, street, city, housenumber)
      VALUES ('delete', OLD.id, OLD.name, OLD.brand, OLD.category, OLD.street, OLD.city, OLD.housenumber);
    INSERT INTO search_docs_trigram(search_docs_trigram, rowid, name, street, city)
      VALUES ('delete', OLD.id, OLD.name, OLD.street, OLD.city);
  END;

  CREATE TRIGGER IF NOT EXISTS search_docs_fts_update AFTER UPDATE ON search_docs BEGIN
    INSERT INTO search_docs_fts(search_docs_fts, rowid, name, brand, category, street, city, housenumber)
      VALUES ('delete', OLD.id, OLD.name, OLD.brand, OLD.category, OLD.street, OLD.city, OLD.housenumber);
    INSERT INTO search_docs_trigram(search_docs_trigram, rowid, name, street, city)
      VALUES ('delete', OLD.id, OLD.name, OLD.street, OLD.city);
    INSERT INTO search_docs_fts(rowid, name, brand, category, street, city, housenumber)
      VALUES (NEW.id, NEW.name, NEW.brand, NEW.category, NEW.street, NEW.city, NEW.housenumber);
    INSERT INTO search_docs_trigram(rowid, name, street, city)
      VALUES (NEW.id, NEW.name, NEW.street, NEW.city);
  END;

  -- ── places → search_docs ───────────────────────────────────────────
  CREATE TRIGGER IF NOT EXISTS search_docs_from_places_insert AFTER INSERT ON places BEGIN
    INSERT INTO search_docs (
      doc_key, kind, name, brand, category, street, city, state, postcode,
      country, lat, lng, importance, ref_id
    ) VALUES (
      'place:' || NEW.uuid, 'poi', NEW.name, NEW.brand_name, NEW.category,
      NEW.address_street, NEW.address_city, NEW.address_state,
      NEW.address_postcode, NEW.address_country, NEW.lat, NEW.lng,
      COALESCE(NEW.review_count, 0) / 50.0, NEW.uuid
    )
    ON CONFLICT(doc_key) DO UPDATE SET
      kind = 'poi', name = NEW.name, brand = NEW.brand_name, category = NEW.category,
      street = NEW.address_street, city = NEW.address_city, state = NEW.address_state,
      postcode = NEW.address_postcode, country = NEW.address_country,
      lat = NEW.lat, lng = NEW.lng,
      importance = COALESCE(NEW.review_count, 0) / 50.0;
  END;

  CREATE TRIGGER IF NOT EXISTS search_docs_from_places_delete AFTER DELETE ON places BEGIN
    DELETE FROM search_docs WHERE doc_key = 'place:' || OLD.uuid;
  END;

  CREATE TRIGGER IF NOT EXISTS search_docs_from_places_update AFTER UPDATE ON places BEGIN
    INSERT INTO search_docs (
      doc_key, kind, name, brand, category, street, city, state, postcode,
      country, lat, lng, importance, ref_id
    ) VALUES (
      'place:' || NEW.uuid, 'poi', NEW.name, NEW.brand_name, NEW.category,
      NEW.address_street, NEW.address_city, NEW.address_state,
      NEW.address_postcode, NEW.address_country, NEW.lat, NEW.lng,
      COALESCE(NEW.review_count, 0) / 50.0, NEW.uuid
    )
    ON CONFLICT(doc_key) DO UPDATE SET
      name = NEW.name, brand = NEW.brand_name, category = NEW.category,
      street = NEW.address_street, city = NEW.address_city, state = NEW.address_state,
      postcode = NEW.address_postcode, country = NEW.address_country,
      lat = NEW.lat, lng = NEW.lng,
      importance = COALESCE(NEW.review_count, 0) / 50.0;
  END;

  -- ── geocoding_data → search_docs ───────────────────────────────────
  CREATE TRIGGER IF NOT EXISTS search_docs_from_geo_insert AFTER INSERT ON geocoding_data BEGIN
    INSERT INTO search_docs (
      doc_key, kind, name, housenumber, street, city, state, postcode, country,
      lat, lng, importance, interpolated, region_id, ref_id
    ) VALUES (
      'geo:' || NEW.id,
      CASE
        WHEN NEW.type = 'city' THEN 'locality'
        WHEN NEW.type = 'place' THEN 'admin'
        ELSE 'address'
      END,
      NEW.text, NEW.housenumber, NEW.street, NEW.city, NEW.state,
      NEW.postcode, NEW.country, NEW.lat, NEW.lng,
      CASE
        WHEN NEW.type = 'city' THEN 3.0
        WHEN NEW.type = 'place' THEN 2.0
        WHEN NEW.type = 'address_interpolated' THEN 0.5
        ELSE 1.0
      END,
      CASE WHEN NEW.type = 'address_interpolated' THEN 1 ELSE 0 END,
      NEW.region_id, CAST(NEW.id AS TEXT)
    )
    ON CONFLICT(doc_key) DO UPDATE SET
      name = NEW.text, housenumber = NEW.housenumber, street = NEW.street,
      city = NEW.city, state = NEW.state, postcode = NEW.postcode,
      country = NEW.country, lat = NEW.lat, lng = NEW.lng,
      interpolated = CASE WHEN NEW.type = 'address_interpolated' THEN 1 ELSE 0 END,
      region_id = NEW.region_id;
  END;

  CREATE TRIGGER IF NOT EXISTS search_docs_from_geo_delete AFTER DELETE ON geocoding_data BEGIN
    DELETE FROM search_docs WHERE doc_key = 'geo:' || OLD.id;
  END;

  CREATE TRIGGER IF NOT EXISTS search_docs_from_geo_update AFTER UPDATE ON geocoding_data BEGIN
    INSERT INTO search_docs (
      doc_key, kind, name, housenumber, street, city, state, postcode, country,
      lat, lng, importance, interpolated, region_id, ref_id
    ) VALUES (
      'geo:' || NEW.id,
      CASE
        WHEN NEW.type = 'city' THEN 'locality'
        WHEN NEW.type = 'place' THEN 'admin'
        ELSE 'address'
      END,
      NEW.text, NEW.housenumber, NEW.street, NEW.city, NEW.state,
      NEW.postcode, NEW.country, NEW.lat, NEW.lng,
      CASE
        WHEN NEW.type = 'city' THEN 3.0
        WHEN NEW.type = 'place' THEN 2.0
        WHEN NEW.type = 'address_interpolated' THEN 0.5
        ELSE 1.0
      END,
      CASE WHEN NEW.type = 'address_interpolated' THEN 1 ELSE 0 END,
      NEW.region_id, CAST(NEW.id AS TEXT)
    )
    ON CONFLICT(doc_key) DO UPDATE SET
      name = NEW.text, housenumber = NEW.housenumber, street = NEW.street,
      city = NEW.city, state = NEW.state, postcode = NEW.postcode,
      country = NEW.country, lat = NEW.lat, lng = NEW.lng,
      interpolated = CASE WHEN NEW.type = 'address_interpolated' THEN 1 ELSE 0 END,
      region_id = NEW.region_id;
  END;
`;

/**
 * Spatial index over `geocoding_data`, plus the triggers that maintain it.
 *
 * Reverse geocoding is "nearest row inside a box", which without an index reads
 * every row in the table — and a metro pack holds hundreds of thousands once
 * interpolated house numbers are expanded, so every dropped pin paid for a full
 * scan. The R*Tree turns that into an index lookup.
 *
 * Triggers mirror the `geocoding_trigram` pattern so every write path (pack
 * import, per-region cascade delete) maintains the index without any caller
 * having to remember. The R*Tree stores 32-bit floats (~0.5 m at mid
 * latitudes), so it only narrows candidates; ordering is computed against the
 * real columns in `geocoding/reverseQuery.ts`.
 *
 * Exported for the schema regression suite, which runs it against node:sqlite.
 */
export const GEOCODING_RTREE_DDL = `
  CREATE VIRTUAL TABLE IF NOT EXISTS geocoding_rtree USING rtree(
    id, min_lat, max_lat, min_lng, max_lng
  );
`;

/** Trigger families keeping `geocoding_rtree` level with `geocoding_data`. */
export const GEOCODING_RTREE_TRIGGERS = `
  CREATE TRIGGER IF NOT EXISTS geocoding_rtree_insert AFTER INSERT ON geocoding_data BEGIN
    INSERT INTO geocoding_rtree(id, min_lat, max_lat, min_lng, max_lng)
      VALUES (NEW.id, NEW.lat, NEW.lat, NEW.lng, NEW.lng);
  END;

  CREATE TRIGGER IF NOT EXISTS geocoding_rtree_delete AFTER DELETE ON geocoding_data BEGIN
    DELETE FROM geocoding_rtree WHERE id = OLD.id;
  END;

  CREATE TRIGGER IF NOT EXISTS geocoding_rtree_update AFTER UPDATE ON geocoding_data BEGIN
    DELETE FROM geocoding_rtree WHERE id = OLD.id;
    INSERT INTO geocoding_rtree(id, min_lat, max_lat, min_lng, max_lng)
      VALUES (NEW.id, NEW.lat, NEW.lat, NEW.lng, NEW.lng);
  END;
`;

/**
 * Create the reverse-geocoding index and backfill it from existing rows.
 *
 * Existing installs already hold pack data, so the backfill is part of the
 * migration rather than a download-time step. Idempotent: a database that
 * already has the index only gets a repair pass (an app killed mid-backfill
 * leaves the index short of the table; the count comparison catches it).
 */
export async function migrateGeocodingRtree(
  database: Pick<SQLite.SQLiteDatabase, 'execAsync' | 'getFirstAsync'>,
): Promise<void> {
  const existing = await database.getFirstAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'geocoding_rtree'",
  );

  if (existing) {
    const counts = await database.getFirstAsync<{ rows: number; indexed: number }>(
      `SELECT (SELECT COUNT(*) FROM geocoding_data) AS rows,
              (SELECT COUNT(*) FROM geocoding_rtree) AS indexed`,
    );
    const rows = counts?.rows ?? 0;
    const indexed = counts?.indexed ?? 0;
    if (indexed >= rows) return;
  } else {
    await database.execAsync(GEOCODING_RTREE_DDL);
  }

  await database.execAsync(GEOCODING_RTREE_TRIGGERS);
  // Rewrite rather than append: this runs for a missing index and for a
  // partial one, and a plain INSERT would duplicate the rows already indexed.
  await database.execAsync(`
    DELETE FROM geocoding_rtree;
    INSERT INTO geocoding_rtree(id, min_lat, max_lat, min_lng, max_lng)
      SELECT id, lat, lat, lng, lng FROM geocoding_data;
  `);
}

export async function closeDatabase(): Promise<void> {
  if (db) {
    await db.closeAsync();
    db = null;
  }
}
