/**
 * Fetches rail-based transit route geometries from Overpass API.
 *
 * Lightweight viewport-only queries: fetches only what's visible on screen.
 * Results are cached in memory with spatial bucketing so previously-loaded
 * areas are never re-fetched. The accumulated cache persists across
 * toggle on/off cycles.
 */

import type { TransitMode, TransitRouteLine, TransitRouteLineStop } from '../../models/transit';

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const OVERPASS_TIMEOUT_MS = 25_000;

// ── Spatial tile cache ──────────────────────────────────────────────

/**
 * We bucket the world into ~0.05° tiles (~5 km). Each tile is fetched
 * once and cached indefinitely (transit networks don't change often).
 * When the viewport moves, only new tiles are fetched.
 */
const TILE_SIZE = 0.05;
const fetchedTiles = new Set<string>();
const tileData = new Map<string, TransitRouteLine[]>();
const inflight = new Map<string, Promise<TransitRouteLine[]>>();

function tileKey(tLat: number, tLng: number): string {
  return `${tLat.toFixed(3)},${tLng.toFixed(3)}`;
}

function tilesForBounds(
  minLat: number,
  minLng: number,
  maxLat: number,
  maxLng: number,
): Array<{ key: string; minLat: number; minLng: number; maxLat: number; maxLng: number }> {
  const tiles: Array<{
    key: string;
    minLat: number;
    minLng: number;
    maxLat: number;
    maxLng: number;
  }> = [];
  const startLat = Math.floor(minLat / TILE_SIZE) * TILE_SIZE;
  const startLng = Math.floor(minLng / TILE_SIZE) * TILE_SIZE;
  for (let lat = startLat; lat < maxLat; lat += TILE_SIZE) {
    for (let lng = startLng; lng < maxLng; lng += TILE_SIZE) {
      const key = tileKey(lat, lng);
      tiles.push({
        key,
        minLat: lat,
        minLng: lng,
        maxLat: lat + TILE_SIZE,
        maxLng: lng + TILE_SIZE,
      });
    }
  }
  return tiles;
}

// ── Overpass query ───────────────────────────────────────────────────

function routeMode(tags: Record<string, string>): TransitMode {
  const r = tags.route;
  if (r === 'subway') return 'SUBWAY';
  if (r === 'light_rail' || r === 'tram') return 'TRAM';
  if (r === 'train' || r === 'railway' || r === 'monorail') return 'RAIL';
  return 'RAIL';
}

function parseColor(tags: Record<string, string>): string | undefined {
  const c = tags.colour ?? tags.color;
  if (!c) return undefined;
  const hex = c.replace('#', '');
  if (/^[0-9A-Fa-f]{6}$/.test(hex)) return hex;
  return undefined;
}

interface OverpassRelation {
  type: 'relation';
  id: number;
  tags?: Record<string, string>;
  members?: Array<{
    type: string;
    ref: number;
    role: string;
    geometry?: Array<{ lat: number; lon: number }> | null;
    lat?: number;
    lon?: number;
    tags?: Record<string, string>;
  }>;
}

interface StopNode {
  type: 'node';
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
}

function relationToLine(
  rel: OverpassRelation,
  stopNames: Map<number, string>,
): TransitRouteLine | null {
  const tags = rel.tags ?? {};
  if (!tags.route) return null;

  const segments: [number, number][][] = [];
  const stops: TransitRouteLineStop[] = [];

  for (const m of rel.members ?? []) {
    if (m.type === 'way' && m.geometry) {
      const seg: [number, number][] = [];
      for (const pt of m.geometry) {
        if (pt.lat != null && pt.lon != null) seg.push([pt.lon, pt.lat]);
      }
      if (seg.length >= 2) segments.push(seg);
    }
    if (
      m.type === 'node' &&
      m.lat != null &&
      m.lon != null &&
      (m.role === 'stop' ||
        m.role === 'platform' ||
        m.role === 'stop_exit_only' ||
        m.role === 'stop_entry_only')
    ) {
      const name = stopNames.get(m.ref) ?? m.tags?.name;
      if (name) {
        stops.push({ name, lat: m.lat, lon: m.lon, stopId: `osm:node:${m.ref}` });
      }
    }
  }

  if (segments.length === 0) return null;

  // Inline Douglas-Peucker simplification (~5.5 m tolerance)
  const simplified = segments.map((seg) => simplify(seg)).filter((s) => s.length >= 2);
  if (simplified.length === 0) return null;

  return {
    id: `osm:relation:${rel.id}`,
    ref: tags.ref,
    name: tags.name,
    operator: tags.operator ?? tags.network,
    color: parseColor(tags),
    mode: routeMode(tags),
    geometry: simplified,
    stops,
  };
}

// ── Douglas-Peucker simplification ──────────────────────────────────

const EPSILON = 0.00005;

function simplify(pts: [number, number][]): [number, number][] {
  if (pts.length <= 2) return pts;
  const first = pts[0];
  const last = pts[pts.length - 1];
  let maxD = 0,
    maxI = 0;
  const dx = last[0] - first[0],
    dy = last[1] - first[1];
  const lenSq = dx * dx + dy * dy;
  for (let i = 1; i < pts.length - 1; i++) {
    let d: number;
    if (lenSq === 0) {
      d = Math.hypot(pts[i][0] - first[0], pts[i][1] - first[1]);
    } else {
      const t = Math.max(
        0,
        Math.min(1, ((pts[i][0] - first[0]) * dx + (pts[i][1] - first[1]) * dy) / lenSq),
      );
      d = Math.hypot(pts[i][0] - (first[0] + t * dx), pts[i][1] - (first[1] + t * dy));
    }
    if (d > maxD) {
      maxD = d;
      maxI = i;
    }
  }
  if (maxD > EPSILON) {
    const left = simplify(pts.slice(0, maxI + 1));
    const right = simplify(pts.slice(maxI));
    return [...left.slice(0, -1), ...right];
  }
  return [first, last];
}

// ── Deduplication ───────────────────────────────────────────────────

function deduplicateLines(lines: TransitRouteLine[]): TransitRouteLine[] {
  const byKey = new Map<string, TransitRouteLine[]>();
  for (const l of lines) {
    const ref = l.ref ?? '';
    const color = l.color ?? '';
    const norm = (l.name ?? '')
      .replace(/\s*\(.*?\)\s*/g, '')
      .replace(/\s*[-–—]\s+.*\bto\b.*$/i, '')
      .replace(/\s*\bto\b\s+.*$/i, '')
      .trim()
      .toLowerCase();
    const key = ref.length <= 3 ? `${ref}::${color}` : `${ref}::${color}::${norm}`;
    (byKey.get(key) ?? (byKey.set(key, []), byKey.get(key)!)).push(l);
  }
  const result: TransitRouteLine[] = [];
  for (const group of byKey.values()) {
    group.sort((a, b) => {
      let na = 0,
        nb = 0;
      for (const s of a.geometry) na += s.length;
      for (const s of b.geometry) nb += s.length;
      return nb - na;
    });
    result.push(group[0]);
  }
  return result;
}

// ── Fetch a single tile from Overpass ────────────────────────────────

async function fetchTile(
  minLat: number,
  minLng: number,
  maxLat: number,
  maxLng: number,
): Promise<TransitRouteLine[]> {
  const bbox = `${minLat},${minLng},${maxLat},${maxLng}`;
  const query = `[out:json][timeout:25];
(
  relation["route"~"^(subway|light_rail|train|tram|monorail)$"](${bbox});
)->.routes;
.routes out body geom;
node(r.routes:"stop");
out tags;
node(r.routes:"platform");
out tags;
node["railway"~"station|stop"]["name"](${bbox});
out tags;`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OVERPASS_TIMEOUT_MS);

  try {
    const res = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Overpass ${res.status}`);

    const data = (await res.json()) as { elements: (OverpassRelation | StopNode)[] };

    const stopNames = new Map<number, string>();
    const relations: OverpassRelation[] = [];
    for (const el of data.elements) {
      if (el.type === 'relation') relations.push(el as OverpassRelation);
      else if (el.type === 'node' && (el as StopNode).tags?.name) {
        stopNames.set(el.id, (el as StopNode).tags!.name!);
      }
    }

    const lines: TransitRouteLine[] = [];
    for (const rel of relations) {
      const line = relationToLine(rel, stopNames);
      if (line) lines.push(line);
    }
    return deduplicateLines(lines);
  } finally {
    clearTimeout(timer);
  }
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Fetch transit route lines for the current viewport.
 *
 * Only tiles not yet fetched are queried. Previously-fetched tiles are
 * served from the persistent in-memory cache. Results accumulate across
 * calls so the map builds up coverage as the user pans.
 *
 * Returns the *full accumulated set* of lines across all fetched tiles,
 * globally deduplicated.
 */
export async function fetchTransitLines(
  minLat: number,
  minLng: number,
  maxLat: number,
  maxLng: number,
): Promise<TransitRouteLine[]> {
  const tiles = tilesForBounds(minLat, minLng, maxLat, maxLng);
  const needed = tiles.filter((t) => !fetchedTiles.has(t.key));

  if (needed.length > 0) {
    // Fetch missing tiles in parallel (max 4 concurrent to be polite)
    const batches: (typeof needed)[] = [];
    for (let i = 0; i < needed.length; i += 4) {
      batches.push(needed.slice(i, i + 4));
    }

    for (const batch of batches) {
      await Promise.all(
        batch.map(async (tile) => {
          // Skip if another call already started this tile
          if (fetchedTiles.has(tile.key)) return;

          // Dedup inflight requests for the same tile
          let promise = inflight.get(tile.key);
          if (!promise) {
            promise = fetchTile(tile.minLat, tile.minLng, tile.maxLat, tile.maxLng);
            inflight.set(tile.key, promise);
          }

          try {
            const lines = await promise;
            tileData.set(tile.key, lines);
            fetchedTiles.add(tile.key);
          } catch {
            // Don't mark as fetched — will retry next time
          } finally {
            inflight.delete(tile.key);
          }
        }),
      );
    }
  }

  // Return globally deduplicated accumulated lines
  const all: TransitRouteLine[] = [];
  for (const lines of tileData.values()) {
    all.push(...lines);
  }
  return deduplicateLines(all);
}

/**
 * Get all cached lines without fetching. Used to restore the map
 * after a toggle without any network call.
 */
export function getCachedLines(): TransitRouteLine[] {
  if (tileData.size === 0) return [];
  const all: TransitRouteLine[] = [];
  for (const lines of tileData.values()) all.push(...lines);
  return deduplicateLines(all);
}

/** Check if we have any cached transit data. */
export function hasCachedLines(): boolean {
  return tileData.size > 0;
}

// ── On-tap route enrichment ─────────────────────────────────────────
/**
 * Cache for reverse-way-lookup results: stop coordinate key → route tags.
 * Once we've queried Overpass for a stop's serving routes, we cache the
 * result so subsequent taps are instant.
 */
interface OverpassRouteTag {
  ref?: string;
  name?: string;
  colour?: string;
  mode: TransitMode;
}
const stopRouteCache = new Map<string, OverpassRouteTag[]>();

function stopKey(lat: number, lon: number): string {
  return `${lat.toFixed(4)},${lon.toFixed(4)}`;
}

/**
 * Find **all** transit route relations whose track (railway ways) passes
 * near the given stop coordinates, even if the relation doesn't list the
 * stop as a member.
 *
 * Strategy: query Overpass for railway ways within 500 m of the stop,
 * then walk backward (`rel(bw)`) to find route relations using those ways.
 * Results are cached per-stop.
 */
export async function fetchRoutesAtStop(lat: number, lon: number): Promise<OverpassRouteTag[]> {
  const key = stopKey(lat, lon);
  const cached = stopRouteCache.get(key);
  if (cached) return cached;

  const query = `[out:json][timeout:15];
way(around:500,${lat},${lon})["railway"~"^(rail|light_rail|subway|tram|narrow_gauge)$"];
rel(bw)["route"~"^(subway|light_rail|train|tram|monorail)$"];
out tags;`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 16_000);

  try {
    const res = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Overpass ${res.status}`);

    const data = (await res.json()) as {
      elements: Array<{ type: string; tags?: Record<string, string> }>;
    };

    const result: OverpassRouteTag[] = [];
    const seen = new Set<string>();

    for (const el of data.elements) {
      if (el.type !== 'relation') continue;
      const tags = el.tags ?? {};
      const ref = tags.ref;
      const name = tags.name;
      const dedup = `${ref ?? ''}::${name ?? ''}`;
      if (seen.has(dedup)) continue;
      seen.add(dedup);
      result.push({
        ref,
        name,
        colour: parseColor(tags),
        mode: routeMode(tags),
      });
    }

    stopRouteCache.set(key, result);
    return result;
  } catch {
    // On failure, return empty — the stop card will still show the routes
    // from the relation membership.
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// ── Station OSM tags ────────────────────────────────────────────────

const stationDetailsCache = new Map<string, Record<string, string> | null>();

/**
 * Fetch the raw OSM tags for a transit station at (lat, lon).
 * Queries for nodes/ways tagged railway=station or public_transport=station
 * within 200 m. Results are cached per location.
 */
export async function fetchStationOsmDetails(
  lat: number,
  lon: number,
): Promise<Record<string, string> | null> {
  const key = stopKey(lat, lon);
  if (stationDetailsCache.has(key)) return stationDetailsCache.get(key) ?? null;

  const query = `[out:json][timeout:10];
(
  node(around:200,${lat},${lon})["railway"~"^(station|halt)$"];
  node(around:200,${lat},${lon})["public_transport"="station"];
  way(around:200,${lat},${lon})["railway"~"^(station|halt)$"];
);
out tags;`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);

  try {
    const res = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Overpass ${res.status}`);

    const data = (await res.json()) as { elements: Array<{ tags?: Record<string, string> }> };
    // Prefer elements that have a name tag (station nodes vs platform nodes)
    const el = data.elements.find((e) => e.tags?.name) ?? data.elements[0];
    const result = el?.tags ?? null;
    stationDetailsCache.set(key, result);
    return result;
  } catch {
    stationDetailsCache.set(key, null);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
