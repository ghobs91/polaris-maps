import * as FileSystem from 'expo-file-system/legacy';
import * as SQLite from 'expo-sqlite';
import {
  importOverturePlacesFromGeoJSON,
  overtureFeatureToPlace,
  upsertPlacesInBatches,
} from '../poi/overtureFetcher';
import type { Place } from '../../models/poi';
import type { OverturePlace, OverturePlaceCollection } from '../../types/overture';

/**
 * Refuse to import extracts above this size. The GeoJSON importer reads the
 * whole document into memory (`readAsStringAsync` + `JSON.parse`), so an
 * oversized extract would risk OOM; use the prebuilt SQLite bundle instead.
 */
const MAX_OVERTURE_GEOJSON_BYTES = 64 * 1024 * 1024;

/** Rows read from the bundle SQLite per batch. */
const BUNDLE_BATCH_ROWS = 500;

/**
 * Import Overture Maps places bundled with a downloaded region.
 *
 * Looks for an `overture-places.geojson` file in the region directory
 * (produced by `scripts/generate-region-data.sh` step 5, or decompressed from
 * the catalog's `placesUrl` bundle) and upserts all valid features into the
 * local SQLite `places` table with source='overture'.
 *
 * Safe to call even if the file doesn't exist (returns 0).
 */
export async function importRegionOverturePlaces(regionDir: string): Promise<number> {
  const filePath = `${regionDir}overture-places.geojson`;

  const info = await FileSystem.getInfoAsync(filePath);
  if (!info.exists) return 0;

  const size = (info as { size?: number }).size;
  if (size != null && size > MAX_OVERTURE_GEOJSON_BYTES) {
    console.warn(
      `[regions] skipping Overture extract (${Math.round(size / 1_048_576)} MB ` +
        `> ${MAX_OVERTURE_GEOJSON_BYTES / 1_048_576} MB cap); ship a prebuilt SQLite bundle`,
    );
    return 0;
  }

  const raw = await FileSystem.readAsStringAsync(filePath);
  const geojson: OverturePlaceCollection = JSON.parse(raw);

  if (geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
    return 0;
  }

  return importOverturePlacesFromGeoJSON(geojson);
}

// ---------------------------------------------------------------------------
// Prebuilt SQLite bundle (memory-safe path for large regions)
// ---------------------------------------------------------------------------

/** One row of the bundle `places` table written by `build-region-bundle.sh`. */
interface OvertureBundleRow {
  id: string;
  name: string | null;
  basic_category: string | null;
  category_primary: string | null;
  taxonomy_primary: string | null;
  taxonomy_hierarchy: string | null;
  confidence: number | null;
  operating_status: string | null;
  lng: number;
  lat: number;
  addr_freeform: string | null;
  addr_locality: string | null;
  addr_region: string | null;
  addr_postcode: string | null;
  addr_country: string | null;
  phone: string | null;
  website: string | null;
  brand_wikidata: string | null;
  brand_name: string | null;
}

/** Bundle columns, kept in sync with `build-region-bundle.sh`. */
const BUNDLE_COLUMNS = `id, name, basic_category, category_primary, taxonomy_primary,
  taxonomy_hierarchy, confidence, operating_status, lng, lat, addr_freeform,
  addr_locality, addr_region, addr_postcode, addr_country, phone, website,
  brand_wikidata, brand_name`;

function parseJsonArray(value: string | null): string[] | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as string[]) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Rebuild a minimal Overture feature from a flat bundle row so the shared
 * `overtureFeatureToPlace` mapping (category, status, confidence filter,
 * geohash) is reused rather than duplicated.
 */
function rowToOvertureFeature(row: OvertureBundleRow): OverturePlace {
  const properties: OverturePlace['properties'] = {
    id: row.id,
    confidence: row.confidence ?? undefined,
    operating_status:
      (row.operating_status as OverturePlace['properties']['operating_status']) ?? undefined,
    basic_category: row.basic_category ?? undefined,
  };

  if (row.name) properties.names = { primary: row.name };
  if (row.category_primary) properties.categories = { primary: row.category_primary };
  if (row.taxonomy_primary || row.taxonomy_hierarchy) {
    properties.taxonomy = {
      primary: row.taxonomy_primary ?? undefined,
      hierarchy: parseJsonArray(row.taxonomy_hierarchy),
    };
  }
  if (
    row.addr_freeform ||
    row.addr_locality ||
    row.addr_region ||
    row.addr_postcode ||
    row.addr_country
  ) {
    properties.addresses = [
      {
        freeform: row.addr_freeform ?? undefined,
        locality: row.addr_locality ?? undefined,
        region: row.addr_region ?? undefined,
        postcode: row.addr_postcode ?? undefined,
        country: row.addr_country ?? undefined,
      },
    ];
  }
  if (row.phone) properties.phones = [row.phone];
  if (row.website) properties.websites = [row.website];
  if (row.brand_wikidata || row.brand_name) {
    properties.brand = {
      wikidata: row.brand_wikidata,
      names: row.brand_name ? { primary: row.brand_name } : undefined,
    };
  }

  return {
    type: 'Feature',
    id: row.id,
    geometry: { type: 'Point', coordinates: [row.lng, row.lat] },
    properties,
  };
}

/**
 * Import Overture places from a prebuilt SQLite bundle. Rows are paged and
 * mapped in bounded batches, so a region with hundreds of thousands of places
 * never needs the whole dataset in memory. Returns the number of places
 * written (after the shared validity/confidence filtering).
 */
export async function importRegionOverturePlacesFromSqlite(dbPath: string): Promise<number> {
  const src = await SQLite.openDatabaseAsync(dbPath, { enableChangeListener: false });
  try {
    const table = await src.getFirstAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'places'",
    );
    if (!table) return 0;

    const countRow = await src.getFirstAsync<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM places');
    const total = countRow?.cnt ?? 0;
    if (total === 0) return 0;

    let offset = 0;
    async function* batches(): AsyncIterable<Place[]> {
      while (offset < total) {
        const rows = await src.getAllAsync<OvertureBundleRow>(
          `SELECT ${BUNDLE_COLUMNS} FROM places LIMIT ? OFFSET ?`,
          [BUNDLE_BATCH_ROWS, offset],
        );
        if (rows.length === 0) break;
        offset += rows.length;

        const places = rows
          .map(rowToOvertureFeature)
          .map(overtureFeatureToPlace)
          .filter((p): p is Place => p !== null);
        if (places.length > 0) yield places;
      }
    }

    return await upsertPlacesInBatches(batches());
  } finally {
    await src.closeAsync();
  }
}
