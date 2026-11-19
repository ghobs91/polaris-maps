/**
 * Development-only runtime probe for the search pipeline.
 *
 * Opt-in: set `EXPO_PUBLIC_SEARCH_PROBE=1` in `.env` to have a dev build run
 * the sweep 15 s after launch and write it to `Documents/search-probe.json`
 * (readable with `xcrun simctl get_app_container booted com.polarismaps.app
 * data`). Off by default because it hits the network and writes a file.
 *
 * Search quality is a runtime property: it depends on the real SQLite index,
 * the real Overpass/Photon/MapKit sources and the device's downloaded region
 * data. Unit tests can only assert the policy, so verifying a change means
 * running the real pipeline and reading back the area it answered in.
 *
 * This exposes the same entry points the UI calls, plus a `sweep()` that runs a
 * list of queries and returns a compact, copy-pasteable report. Attach with the
 * Hermes inspector (`/json/list` → `Runtime.evaluate`) and call
 * `await __polarisSearchProbe.sweep()`.
 *
 * Never installed in a release build.
 */

import { unifiedSearch } from '@/services/search/unifiedSearch';
import { clearSearchCache } from '@/services/search/searchCache';
import { searchByCategory } from '@/services/poi/categorySearchService';
import { useMapStore } from '@/stores/mapStore';
import { useOsmPoiStore } from '@/stores/osmPoiStore';

interface ProbeResult {
  query: string;
  radiusKm: number | null;
  strongMatches?: number;
  candidates?: number;
  resultCount: number;
  /** Distinct place names, so a browser of the report sees the actual answer. */
  names: string[];
}

async function searchOnce(
  query: string,
  anchor: { lat: number; lng: number },
  limit = 30,
): Promise<ProbeResult> {
  let horizon: { radiusKm: number; anchor: { lat: number; lng: number } } | undefined;
  const results = await unifiedSearch(query, {
    lat: anchor.lat,
    lng: anchor.lng,
    zoom: 14,
    limit,
    onStage: (_results, meta) => {
      if (meta.final) horizon = meta.horizon;
    },
  });

  return {
    query,
    radiusKm: horizon?.radiusKm ?? null,
    resultCount: results.length,
    names: results.slice(0, 8).map((r) => `${r.name} (${(r.distanceKm ?? 0).toFixed(1)}km)`),
  };
}

/**
 * Run the category (pill) path the panel uses at a given anchor.
 *
 * The panel answers a pill with the unified engine (same pipeline as typing the
 * phrase) and reads the area the engine decided on. This mirrors that so the
 * report measures the shipped path.
 */
async function pillOnceAt(
  query: string,
  anchor: { lat: number; lng: number },
): Promise<ProbeResult> {
  let radiusKm: number | null = null;
  const results = await unifiedSearch(query, {
    lat: anchor.lat,
    lng: anchor.lng,
    zoom: 14,
    limit: 60,
    onStage: (_results, meta) => {
      if (meta.final) radiusKm = meta.horizon?.radiusKm ?? null;
    },
  });
  const pois = results.map((r) => r.poi).filter((p): p is NonNullable<typeof p> => p != null);
  return {
    query: `${query} (pill)`,
    radiusKm,
    resultCount: pois.length,
    candidates: results.length,
    names: pois.slice(0, 8).map((p, i) => `${p.name} (${i})`),
  };
}

export async function sweep(queries: string[] = ['whole foods', 'coffee', 'airport']): Promise<{
  anchor: { lat: number; lng: number; zoom: number };
  results: ProbeResult[];
}> {
  const viewport = useMapStore.getState().viewport;
  const anchor = { lat: viewport.lat, lng: viewport.lng };
  const results: ProbeResult[] = [];
  for (const query of queries) results.push(await searchOnce(query, anchor));
  return { anchor: viewport, results };
}

/**
 * Dump the ranked candidates for a query, with the fields the ranker scored on.
 *
 * Ranking bugs are data problems ("why is this business above the airport?"),
 * so the diagnosis needs to see subtype/type/tags and the resulting score, not
 * just the top names.
 */
export async function dumpCandidates(
  query: string,
  anchor: { lat: number; lng: number },
): Promise<
  Array<{
    rank: number;
    name: string;
    type: string;
    subtype: string | null;
    distanceKm: number;
    score: number;
    rating?: string;
    reviews?: string;
    brand?: string;
  }>
> {
  // The result cache is keyed by the fetch box, not by the viewport box, so a
  // previous search of the same query would hand back its scores.
  clearSearchCache();
  const results = await unifiedSearch(query, {
    lat: anchor.lat,
    lng: anchor.lng,
    zoom: 14,
    limit: 40,
    // What the panel passes: the visible screen at zoom 14 (~±0.01°). Without
    // it the engine falls back to the fetch box, which now spans 30–40 km and
    // makes every candidate "in viewport" — flat scores, meaningless report.
    viewportBounds: {
      south: anchor.lat - 0.01,
      north: anchor.lat + 0.01,
      west: anchor.lng - 0.012,
      east: anchor.lng + 0.012,
    },
  });
  return results.map((r, i) => ({
    rank: i,
    name: r.name,
    type: String(r.osmType ?? ''),
    subtype: r.osmSubtype ?? null,
    distanceKm: Number((r.distanceKm ?? 0).toFixed(1)),
    score: Number(r.score.toFixed(1)),
    rating: r.poi?.tags['polaris:avg_rating'],
    reviews: r.poi?.tags['polaris:review_count'],
    brand: r.poi?.tags['polaris:brand'] ?? r.poi?.tags['brand'],
  }));
}

/** Report the pins the map is currently rendering for a search. */
export function mapState(): {
  pins: number;
  names: string[];
  viewport: { lat: number; lng: number; zoom: number };
} {
  const pins = useOsmPoiStore.getState().categorySearchResults ?? [];
  return {
    pins: pins.length,
    names: pins.slice(0, 10).map((p) => p.name),
    viewport: useMapStore.getState().viewport,
  };
}

export const probe = {
  unifiedSearch,
  searchByCategory,
  sweep,
  pillOnceAt,
  mapState,
  writeReportToDisk,
};

/**
 * Run the sweep and write it to the app's Documents directory.
 *
 * The Hermes inspector is not always attachable (a second debugger gets no
 * responses), so the probe can also report to a file that `simctl
 * get_app_container … data` can read from the host. Dev builds only, never in
 * Jest.
 */
export async function writeReportToDisk(
  // Levittown, NY — the area in the reference screenshots.
  anchor: { lat: number; lng: number } = { lat: 40.7287, lng: -73.5315 },
): Promise<string> {
  // The Map tab's viewport is only meaningful once the map is mounted (a cold
  // start on the consent screen reports 0,0), so the report is anchored
  // explicitly and `pillOnce` is given the same point.
  const report = {
    at: new Date().toISOString(),
    anchor,
    search: {
      anchor: { ...anchor, zoom: 14, bearing: 0, pitch: 0 },
      results: [
        await searchOnce('whole foods', anchor),
        await searchOnce('coffee', anchor),
        await searchOnce('airport', anchor),
        await searchOnce('starbucks', anchor),
      ],
    },
    pills: [await pillOnceAt('coffee', anchor), await pillOnceAt('restaurant', anchor)],
    ranking: {
      airport: await dumpCandidates('airport', anchor),
      hotel: await dumpCandidates('hotel', anchor),
      bank: await dumpCandidates('bank', anchor),
      coffee: await dumpCandidates('coffee', anchor),
    },
  };
  const FileSystem = await import('expo-file-system/legacy');
  const uri = `${FileSystem.documentDirectory}search-probe.json`;
  await FileSystem.writeAsStringAsync(uri, JSON.stringify(report, null, 2));
  return uri;
}

if (__DEV__) {
  (globalThis as unknown as { __polarisSearchProbe?: typeof probe }).__polarisSearchProbe = probe;

  const inJest =
    typeof process !== 'undefined' &&
    (process.env.JEST_WORKER_ID ?? process.env.NODE_ENV) === 'test';
  if (!inJest && process.env.EXPO_PUBLIC_SEARCH_PROBE === '1') {
    // Let the map, the database and the region packs finish loading first.
    setTimeout(() => {
      void writeReportToDisk().catch((error: unknown) => {
        console.warn('[search] probe report failed', error);
      });
    }, 15_000);
  }
}
