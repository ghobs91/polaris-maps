/**
 * Region-pack search indices.
 *
 * A downloaded pack may ship two optional SQLite artifacts that keep Overpass
 * off the critical path for the covered area:
 *
 * - `search.sqlite`  — named OSM POIs (see `services/poi/localPoiIndex`)
 * - `transit.sqlite` — stops, route relations and the stop↔route join
 *                      (see `services/transit/localTransitIndex`)
 *
 * Both are optional: a pack without them behaves exactly as before, falling
 * back to the network. Import is best-effort and idempotent — the download flow
 * must not fail because an index could not be read.
 *
 * The pack builder produces them from the same OSM snapshot as the pack's other
 * assets and lists them in the pack index, so their bytes are covered by the
 * region manifest's `contentHash`.
 */

import * as FileSystem from 'expo-file-system/legacy';

import { importLocalPoiIndexFromPack } from '../poi/localPoiIndex';
import { importLocalTransitIndexFromPack } from '../transit/localTransitIndex';
import { logDiagnostic } from '../diagnostics/diagnosticsLog';

export interface PackBoundaries {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export interface PackIndexImportResult {
  poiRows: number;
  transitStops: number;
  transitRoutes: number;
}

const EMPTY_RESULT: PackIndexImportResult = { poiRows: 0, transitStops: 0, transitRoutes: 0 };

async function fileExists(path: string): Promise<boolean> {
  try {
    const info = await FileSystem.getInfoAsync(path);
    return info.exists && !info.isDirectory;
  } catch {
    return false;
  }
}

/**
 * Import whichever search indices the pack contains.
 *
 * Never throws: a malformed index logs a diagnostic and leaves the previous
 * data in place, so a bad pack degrades to network fallback instead of a broken
 * download.
 */
export async function importPackSearchIndices(
  regionId: string,
  dirPath: string,
  bounds: PackBoundaries,
): Promise<PackIndexImportResult> {
  const geoBounds = {
    south: bounds.minLat,
    west: bounds.minLng,
    north: bounds.maxLat,
    east: bounds.maxLng,
  };
  const result: PackIndexImportResult = { ...EMPTY_RESULT };

  const poiPath = `${dirPath}/search.sqlite`;
  if (await fileExists(poiPath)) {
    try {
      result.poiRows = await importLocalPoiIndexFromPack(poiPath, regionId, geoBounds);
      logDiagnostic('regions', 'info', 'imported pack POI index', {
        regionId,
        rows: result.poiRows,
      });
    } catch (err) {
      logDiagnostic('regions', 'warn', 'pack POI index import failed', {
        regionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const transitPath = `${dirPath}/transit.sqlite`;
  if (await fileExists(transitPath)) {
    try {
      const { stops, routes } = await importLocalTransitIndexFromPack(
        transitPath,
        regionId,
        geoBounds,
      );
      result.transitStops = stops;
      result.transitRoutes = routes;
      logDiagnostic('regions', 'info', 'imported pack transit index', {
        regionId,
        stops,
        routes,
      });
    } catch (err) {
      logDiagnostic('regions', 'warn', 'pack transit index import failed', {
        regionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

/**
 * Register the pack's transit timetable, if it shipped one.
 *
 * Unlike the two indices above, the timetable is **not** imported into the main
 * database: it holds millions of connection rows, so copying it would double
 * the bytes on disk and stall the download. It is opened where it lies and
 * queried read-only (`services/transit/transitTimetable`).
 *
 * Never throws: a missing or malformed timetable just means Tier 0 planning is
 * unavailable for this region, and the planner falls through to a live source.
 */
export async function registerPackTimetable(
  regionId: string,
  dirPath: string,
  bounds: PackBoundaries,
): Promise<boolean> {
  // Imported lazily: the timetable module pulls the SQLite + storage stack, and
  // the download path should only pay for it when a pack actually ships one.
  const { TRANSIT_TIMETABLE_ASSET, registerTimetable, unregisterTimetable } =
    await import('../transit/transitTimetable');

  const path = `${dirPath}/${TRANSIT_TIMETABLE_ASSET}`;
  if (!(await fileExists(path))) {
    // A re-download that no longer ships a timetable must not leave the old
    // registration pointing at a file that is gone.
    unregisterTimetable(regionId);
    return false;
  }

  try {
    registerTimetable({
      regionId,
      path,
      bounds: {
        south: bounds.minLat,
        west: bounds.minLng,
        north: bounds.maxLat,
        east: bounds.maxLng,
      },
      installedAt: Date.now(),
    });
    logDiagnostic('regions', 'info', 'registered pack transit timetable', { regionId });
    return true;
  } catch (err) {
    logDiagnostic('regions', 'warn', 'pack transit timetable registration failed', {
      regionId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
