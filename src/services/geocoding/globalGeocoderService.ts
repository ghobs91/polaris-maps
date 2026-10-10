/**
 * Global coarse geocoder backed by the GeoNames cities1000 database.
 *
 * The geonames.sqlite.gz file (~20-25 MB) is downloaded once from CDN
 * and stored locally. It contains ~140k cities with population >= 1000,
 * searchable via FTS5 and spatially indexed via R-Tree.
 *
 * Used for:
 * - Offline city-level search ("Paris", "Tokyo", "São Paulo")
 * - Fallback when Photon/Nominatim are unreachable
 * - Quick coarse results while online sources load
 */

import * as FileSystem from 'expo-file-system/legacy';
import * as SQLite from 'expo-sqlite';
import { gunzipFile } from '../sync/hyperdriveBridge';
import { GEONAMES_DB_URL } from '../../constants/config';
import { storage } from '../storage/mmkv';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GlobalPlace {
  geonameId: number;
  name: string;
  displayName: string;
  lat: number;
  lng: number;
  population: number;
  countryCode: string;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const GEONAMES_DIR = `${FileSystem.documentDirectory}geonames/`;
const GEONAMES_DB_PATH = `${GEONAMES_DIR}geonames.sqlite`;
const MMKV_GEONAMES_READY = 'geonames_db_ready';

let geonamesDb: SQLite.SQLiteDatabase | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns true if the GeoNames database has been downloaded and is ready.
 */
export function isGeonamesReady(): boolean {
  return storage.getBoolean(MMKV_GEONAMES_READY) === true;
}

/**
 * True when a real GeoNames database URL is configured (the default config
 * value is a placeholder, in which case city search is silently disabled).
 */
export function isGeonamesUrlConfigured(): boolean {
  return GEONAMES_DB_URL.length > 0 && !GEONAMES_DB_URL.includes('cdn.example.com');
}

/**
 * Download and prepare the GeoNames database if not already present.
 *
 * - Downloads geonames.sqlite.gz from CDN.
 * - Decompresses via Node.js IPC bridge (same as geocoding bundles).
 * - Marks as ready in MMKV.
 *
 * Safe to call multiple times — no-ops if already downloaded.
 */
export async function ensureGeonamesDb(): Promise<void> {
  if (isGeonamesReady()) {
    // Verify the file actually exists
    const info = await FileSystem.getInfoAsync(GEONAMES_DB_PATH);
    if (info.exists) return;
    // File was deleted externally — re-download
    storage.set(MMKV_GEONAMES_READY, false);
  }

  await FileSystem.makeDirectoryAsync(GEONAMES_DIR, { intermediates: true });

  const gzPath = `${GEONAMES_DIR}geonames.sqlite.gz`;

  // Download the gzipped database
  await FileSystem.downloadAsync(GEONAMES_DB_URL, gzPath);

  // Decompress via Node.js IPC bridge
  await gunzipViaNode(gzPath, GEONAMES_DB_PATH);

  // Clean up .gz
  await FileSystem.deleteAsync(gzPath, { idempotent: true });

  storage.set(MMKV_GEONAMES_READY, true);
}

/**
 * Search the global GeoNames database for cities matching the query.
 *
 * Results are sorted by a combination of FTS rank, population, and
 * proximity to the reference point (if provided).
 */
export async function searchGlobalPlaces(
  query: string,
  refLat?: number,
  refLng?: number,
  limit: number = 15,
): Promise<GlobalPlace[]> {
  if (!query.trim() || !isGeonamesReady()) return [];

  const db = await openGeonamesDb();
  if (!db) return [];

  // FTS5 prefix query
  const ftsQuery = query
    .trim()
    .split(/\s+/)
    .map((w) => `"${w}"*`)
    .join(' ');

  try {
    let rows: GeonamesRow[];

    if (refLat != null && refLng != null) {
      // Use R-Tree for proximity-aware scoring
      // First get FTS matches, then score by distance + population
      rows = await db.getAllAsync<GeonamesRow>(
        `SELECT g.geoname_id, g.name, g.ascii_name, g.lat, g.lng,
                g.population, g.country_code, g.admin1_code, g.timezone,
                f.rank AS fts_rank
         FROM geonames_fts f
         JOIN geonames g ON g.geoname_id = f.rowid
         WHERE geonames_fts MATCH ?
         ORDER BY
           f.rank * 0.3
           + (CASE WHEN g.population > 1000000 THEN -50
                   WHEN g.population > 100000 THEN -30
                   WHEN g.population > 10000 THEN -10
                   ELSE 0 END)
           + ((g.lat - ?) * (g.lat - ?) + (g.lng - ?) * (g.lng - ?)) * 0.01
         LIMIT ?`,
        [ftsQuery, refLat, refLat, refLng, refLng, limit],
      );
    } else {
      // No reference point — rank by FTS relevance + population
      rows = await db.getAllAsync<GeonamesRow>(
        `SELECT g.geoname_id, g.name, g.ascii_name, g.lat, g.lng,
                g.population, g.country_code, g.admin1_code, g.timezone,
                f.rank AS fts_rank
         FROM geonames_fts f
         JOIN geonames g ON g.geoname_id = f.rowid
         WHERE geonames_fts MATCH ?
         ORDER BY g.population DESC, f.rank
         LIMIT ?`,
        [ftsQuery, limit],
      );
    }

    return rows.map(rowToGlobalPlace);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface GeonamesRow {
  geoname_id: number;
  name: string;
  ascii_name: string;
  lat: number;
  lng: number;
  population: number;
  country_code: string | null;
  admin1_code: string | null;
  timezone: string | null;
  fts_rank?: number;
}

function rowToGlobalPlace(row: GeonamesRow): GlobalPlace {
  const parts = [row.name];
  if (row.admin1_code) parts.push(row.admin1_code);
  if (row.country_code) parts.push(row.country_code);

  return {
    geonameId: row.geoname_id,
    name: row.name,
    displayName: parts.join(', '),
    lat: row.lat,
    lng: row.lng,
    population: row.population,
    countryCode: row.country_code ?? '',
  };
}

async function openGeonamesDb(): Promise<SQLite.SQLiteDatabase | null> {
  if (geonamesDb) return geonamesDb;
  try {
    const info = await FileSystem.getInfoAsync(GEONAMES_DB_PATH);
    if (!info.exists) return null;
    geonamesDb = await SQLite.openDatabaseAsync(GEONAMES_DB_PATH, {
      enableChangeListener: false,
      // The geonames bundle carries FTS5 + rtree vtabs; see the note in
      // database/init.ts (expo/expo#38168).
      finalizeUnusedStatementsBeforeClosing: false,
    });
    return geonamesDb;
  } catch {
    return null;
  }
}

/** Gunzip a file via the Bare worklet (replaces the dead Node sidecar). */
function gunzipViaNode(inputPath: string, outputPath: string): Promise<void> {
  return gunzipFile(inputPath, outputPath);
}
