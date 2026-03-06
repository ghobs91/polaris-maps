import * as SQLite from 'expo-sqlite';

let db: SQLite.SQLiteDatabase | null = null;

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  db = await SQLite.openDatabaseAsync('polaris-maps.db');
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
      pmtiles_tx_id TEXT,
      routing_graph_tx_id TEXT,
      geocoding_db_tx_id TEXT,
      version TEXT NOT NULL,
      download_status TEXT NOT NULL DEFAULT 'none',
      tiles_size_bytes INTEGER,
      routing_size_bytes INTEGER,
      geocoding_size_bytes INTEGER,
      downloaded_at INTEGER,
      last_updated INTEGER
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
      speed_limit_kmh INTEGER,
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

    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      poi_uuid TEXT NOT NULL,
      author_pubkey TEXT NOT NULL,
      rating INTEGER NOT NULL,
      text TEXT,
      signature TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (poi_uuid) REFERENCES places(uuid)
    );

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
  `);
}

export async function closeDatabase(): Promise<void> {
  if (db) {
    await db.closeAsync();
    db = null;
  }
}
