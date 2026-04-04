/**
 * Fetches rail-based transit route geometries.
 *
 * Primary source: OTP route/pattern/geometry APIs for regions covered
 * by the endpoint registry (fast, reliable, covers entire transit network).
 *
 * Fallback: Overpass API with viewport-based spatial tile caching for
 * regions without an OTP endpoint.
 *
 * Results are cached in memory and persist across toggle on/off cycles.
 */

import type { TransitMode, TransitRouteLine, TransitRouteLineStop } from '../../models/transit';
import { findEndpointForCoords, type OtpEndpoint } from './otpEndpointRegistry';
import { decodePolyline } from '../../utils/polyline';
import { fetchMbtaLines } from './mbtaFetcher';

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

/** Minimum distance (degrees, ~300 m) for snapping standalone stops to route geometry. */
const SNAP_THRESHOLD_DEG = 0.003;

/** Project a point onto a polyline, returning the fractional cumulative distance along it. */
function projectOntoSegments(
  lat: number,
  lon: number,
  segments: [number, number][][],
): { dist: number; along: number } | null {
  let bestDist = Infinity;
  let bestAlong = 0;
  let cumLen = 0;

  for (const seg of segments) {
    for (let i = 0; i < seg.length - 1; i++) {
      const [ax, ay] = seg[i]; // [lng, lat]
      const [bx, by] = seg[i + 1];
      const segLen = Math.hypot(bx - ax, by - ay);
      if (segLen === 0) continue;
      const t = Math.max(
        0,
        Math.min(1, ((lon - ax) * (bx - ax) + (lat - ay) * (by - ay)) / (segLen * segLen)),
      );
      const px = ax + t * (bx - ax);
      const py = ay + t * (by - ay);
      const d = Math.hypot(lon - px, lat - py);
      if (d < bestDist) {
        bestDist = d;
        bestAlong = cumLen + t * segLen;
      }
      cumLen += segLen;
    }
  }

  return bestDist < Infinity ? { dist: bestDist, along: bestAlong } : null;
}

function relationToLine(
  rel: OverpassRelation,
  stopNodes: Map<number, { name: string; lat: number; lon: number }>,
): TransitRouteLine | null {
  const tags = rel.tags ?? {};
  if (!tags.route) return null;

  const segments: [number, number][][] = [];
  const memberStopIds = new Set<number>();
  const memberStops: Array<{ id: number; name: string; lat: number; lon: number }> = [];

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
      const name = stopNodes.get(m.ref)?.name ?? m.tags?.name;
      if (name) {
        memberStops.push({ id: m.ref, name, lat: m.lat, lon: m.lon });
        memberStopIds.add(m.ref);
      }
    }
  }

  if (segments.length === 0) return null;

  // Snap standalone stop nodes (railway=stop/station) near the route geometry.
  // This catches stops not listed as relation members (common in LIRR and others).
  const snappedStops: Array<{ name: string; lat: number; lon: number; id: number; along: number }> =
    [];

  // First, project member stops
  for (const ms of memberStops) {
    const proj = projectOntoSegments(ms.lat, ms.lon, segments);
    snappedStops.push({
      name: ms.name,
      lat: ms.lat,
      lon: ms.lon,
      id: ms.id,
      along: proj?.along ?? 0,
    });
  }

  // Then, snap standalone stop nodes that are near the route
  for (const [nodeId, node] of stopNodes) {
    if (memberStopIds.has(nodeId)) continue; // already a member
    const proj = projectOntoSegments(node.lat, node.lon, segments);
    if (proj && proj.dist < SNAP_THRESHOLD_DEG) {
      snappedStops.push({
        name: node.name,
        lat: node.lat,
        lon: node.lon,
        id: nodeId,
        along: proj.along,
      });
    }
  }

  // Sort by position along route, deduplicate by name+proximity
  snappedStops.sort((a, b) => a.along - b.along);
  const stops: TransitRouteLineStop[] = [];
  const seenNames = new Set<string>();
  for (const s of snappedStops) {
    const key = `${s.name}:${(s.lat * 200).toFixed(0)}`;
    if (seenNames.has(key)) continue;
    seenNames.add(key);
    stops.push({ name: s.name, lat: s.lat, lon: s.lon, stopId: `osm:node:${s.id}` });
  }

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
out body;
node(r.routes:"platform");
out body;
node["railway"~"station|stop"]["name"](${bbox});
out body;`;

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

    const stopNodes = new Map<number, { name: string; lat: number; lon: number }>();
    const relations: OverpassRelation[] = [];
    for (const el of data.elements) {
      if (el.type === 'relation') relations.push(el as OverpassRelation);
      else if (el.type === 'node') {
        const node = el as StopNode;
        if (node.tags?.name && node.lat != null && node.lon != null) {
          stopNodes.set(node.id, { name: node.tags.name, lat: node.lat, lon: node.lon });
        }
      }
    }

    const lines: TransitRouteLine[] = [];
    for (const rel of relations) {
      const line = relationToLine(rel, stopNodes);
      if (line) lines.push(line);
    }
    return deduplicateLines(lines);
  } finally {
    clearTimeout(timer);
  }
}

// ── OTP-based transit line fetcher ──────────────────────────────────

/**
 * Cache for OTP-sourced route lines.  Keyed by endpoint label.
 * Once fetched for a region, lines are never re-fetched.
 */
const otpLineCache = new Map<string, TransitRouteLine[]>();
const otpLineFetchInFlight = new Map<string, Promise<TransitRouteLine[]>>();

/** Map OTP mode strings to our TransitMode type. */
function otpModeToTransitMode(mode: string): TransitMode {
  switch (mode) {
    case 'SUBWAY':
      return 'SUBWAY';
    case 'RAIL':
      return 'RAIL';
    case 'TRAM':
    case 'LIGHT_RAIL':
      return 'TRAM';
    case 'FERRY':
      return 'FERRY';
    case 'CABLE_CAR':
      return 'CABLE_CAR';
    case 'GONDOLA':
      return 'GONDOLA';
    case 'FUNICULAR':
      return 'FUNICULAR';
    default:
      return 'RAIL';
  }
}

/**
 * Fetch all rail/subway/tram route lines from an OTP1 REST endpoint.
 *
 * Strategy:
 *   1. GET /index/routes → filter to rail modes (fast, ~0.2s)
 *   2. For each route, GET /index/routes/{id}/patterns → pick the longest
 *   3. GET /index/patterns/{id}/geometry → encoded polyline
 *   4. GET /index/patterns/{id} → stop list
 *
 * Steps 2–4 are parallelised (8 concurrent).  Total time for MTA NYC
 * (123 routes): ~4s.  Result is cached permanently.
 */
async function fetchOtpLines(ep: OtpEndpoint): Promise<TransitRouteLine[]> {
  const cached = otpLineCache.get(ep.label);
  if (cached) return cached;

  let inFlight = otpLineFetchInFlight.get(ep.label);
  if (inFlight) return inFlight;

  const promise = (async (): Promise<TransitRouteLine[]> => {
    // Derive the index base URL from the plan URL
    // e.g. .../otp/routers/default/plan → .../otp/routers/default
    const baseUrl = ep.url.replace(/\/plan$/, '');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);

    try {
      // 1. Fetch all routes
      const routesRes = await fetch(`${baseUrl}/index/routes`, {
        signal: controller.signal,
        headers: ep.headers ?? {},
      });
      if (!routesRes.ok) return [];

      const allRoutes = (await routesRes.json()) as Array<{
        id: string;
        shortName?: string;
        longName?: string;
        mode?: string;
        color?: string;
        agencyName?: string;
      }>;

      const railRoutes = allRoutes.filter((r) =>
        ['RAIL', 'SUBWAY', 'TRAM', 'LIGHT_RAIL', 'FERRY', 'CABLE_CAR', 'FUNICULAR'].includes(
          r.mode ?? '',
        ),
      );

      // 2–4. Fetch pattern geometry + stops for each route (8 concurrent)
      const lines: TransitRouteLine[] = [];
      const batches: (typeof railRoutes)[] = [];
      for (let i = 0; i < railRoutes.length; i += 8) {
        batches.push(railRoutes.slice(i, i + 8));
      }

      for (const batch of batches) {
        if (controller.signal.aborted) break;

        const batchResults = await Promise.all(
          batch.map(async (route): Promise<TransitRouteLine | null> => {
            try {
              const routeId = encodeURIComponent(route.id);

              // Get patterns
              const pRes = await fetch(`${baseUrl}/index/routes/${routeId}/patterns`, {
                signal: controller.signal,
                headers: ep.headers ?? {},
              });
              if (!pRes.ok) return null;
              const patterns = (await pRes.json()) as Array<{ id: string; desc?: string }>;
              if (patterns.length === 0) return null;

              // Pick the first pattern (typically the representative one)
              const patternId = encodeURIComponent(patterns[0].id);

              // Fetch geometry and stop list in parallel
              const [geoRes, detailRes] = await Promise.all([
                fetch(`${baseUrl}/index/patterns/${patternId}/geometry`, {
                  signal: controller.signal,
                  headers: ep.headers ?? {},
                }),
                fetch(`${baseUrl}/index/patterns/${patternId}`, {
                  signal: controller.signal,
                  headers: ep.headers ?? {},
                }),
              ]);

              if (!geoRes.ok) return null;
              const geoData = (await geoRes.json()) as { points?: string; length?: number };
              if (!geoData.points) return null;

              // Decode Google-encoded polyline (precision 5)
              const coords = decodePolyline(geoData.points, 5);
              if (coords.length < 2) return null;

              // Parse stops
              const stops: TransitRouteLineStop[] = [];
              if (detailRes.ok) {
                const detail = (await detailRes.json()) as {
                  stops?: Array<{ name?: string; lat?: number; lon?: number; id?: string }>;
                };
                for (const s of detail.stops ?? []) {
                  if (s.name && s.lat != null && s.lon != null) {
                    stops.push({
                      name: s.name,
                      lat: s.lat,
                      lon: s.lon,
                      stopId: s.id ? `otp:${s.id}` : '',
                    });
                  }
                }
              }

              // Normalise color (strip # if present)
              let color = route.color ?? '';
              if (color.startsWith('#')) color = color.slice(1);

              return {
                id: `otp:${route.id}`,
                ref: route.shortName,
                name: route.longName ?? route.shortName,
                operator: route.agencyName,
                color: color || undefined,
                mode: otpModeToTransitMode(route.mode ?? 'RAIL'),
                geometry: [coords],
                stops,
              };
            } catch {
              return null;
            }
          }),
        );

        for (const line of batchResults) {
          if (line) lines.push(line);
        }
      }

      otpLineCache.set(ep.label, lines);
      return lines;
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
      otpLineFetchInFlight.delete(ep.label);
    }
  })();

  otpLineFetchInFlight.set(ep.label, promise);
  return promise;
}

/**
 * Try to fetch transit lines from OTP for the given viewport centre.
 * Returns the lines if a registry endpoint covers the area, or null
 * to signal that Overpass should be used instead.
 */
async function tryFetchViaOtp(
  minLat: number,
  minLng: number,
  maxLat: number,
  maxLng: number,
): Promise<TransitRouteLine[] | null> {
  const centreLat = (minLat + maxLat) / 2;
  const centreLng = (minLng + maxLng) / 2;
  const ep = findEndpointForCoords(centreLat, centreLng);
  if (!ep) return null;

  // MBTA V3 API: dedicated fetcher for the Boston area
  if (ep.apiStyle === 'mbta-v3') {
    const lines = await fetchMbtaLines();
    if (lines.length === 0) return null;
    return lines;
  }

  // OTP1 REST (MTA NYC, TriMet, etc.)
  if (ep.apiStyle !== 'rest-v1') return null;

  const lines = await fetchOtpLines(ep);
  if (lines.length === 0) return null;
  return lines;
}

/**
 * Maximum number of fine-grained tiles to fetch individually.
 * Beyond this threshold we merge needed tiles into coarser "mega-tiles"
 * to avoid issuing hundreds of sequential Overpass requests.
 */
const MAX_INDIVIDUAL_TILES = 16;

/**
 * Approximate side-length of a mega-tile in degrees.
 * Each mega-tile covers 0.20° ≈ 22 km — small enough to avoid Overpass
 * 504s even in dense metros like NYC.
 */
const MEGA_TILE_SIZE = 0.2;

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
  onProgress?: (lines: TransitRouteLine[]) => void,
): Promise<TransitRouteLine[]> {
  // ── Try OTP first (fast, reliable for registry-covered areas) ─────
  // OTP returns the entire transit network for the region in ~4s and
  // caches it permanently, so subsequent toggles are instant.
  try {
    const otpLines = await tryFetchViaOtp(minLat, minLng, maxLat, maxLng);
    if (otpLines && otpLines.length > 0) {
      // Store OTP lines in the tile cache so getCachedLines/hasCachedLines work
      const OTP_CACHE_KEY = '__otp__';
      tileData.set(OTP_CACHE_KEY, otpLines);
      // Mark all viewport tiles as fetched so Overpass won't fire later
      for (const tile of tilesForBounds(minLat, minLng, maxLat, maxLng)) {
        fetchedTiles.add(tile.key);
      }
      return otpLines;
    }
  } catch {
    // OTP failed — fall through to Overpass
  }

  // ── Overpass fallback for regions without an OTP endpoint ─────────

  // Cap the fetch area to avoid overwhelming Overpass on very zoomed-out views
  const MAX_FETCH_SPAN = 0.6;
  const latSpan = maxLat - minLat;
  const lngSpan = maxLng - minLng;
  if (latSpan > MAX_FETCH_SPAN || lngSpan > MAX_FETCH_SPAN) {
    const cLat = (minLat + maxLat) / 2;
    const cLng = (minLng + maxLng) / 2;
    const halfLat = Math.min(latSpan, MAX_FETCH_SPAN) / 2;
    const halfLng = Math.min(lngSpan, MAX_FETCH_SPAN) / 2;
    minLat = cLat - halfLat;
    maxLat = cLat + halfLat;
    minLng = cLng - halfLng;
    maxLng = cLng + halfLng;
  }

  // If a prewarm request is still in flight, abort it
  cancelPrewarm();

  const tiles = tilesForBounds(minLat, minLng, maxLat, maxLng);
  const needed = tiles.filter((t) => !fetchedTiles.has(t.key));

  if (needed.length > 0) {
    if (needed.length <= MAX_INDIVIDUAL_TILES) {
      // ── Fine-grained path: few tiles → fetch individually ─────────
      const batches: (typeof needed)[] = [];
      for (let i = 0; i < needed.length; i += 4) {
        batches.push(needed.slice(i, i + 4));
      }

      for (const batch of batches) {
        await Promise.all(
          batch.map(async (tile) => {
            if (fetchedTiles.has(tile.key)) return;

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

        // Push partial results after each batch so lines appear progressively
        if (onProgress) {
          onProgress(getAllCachedLines());
        }
      }
    } else {
      // ── Mega-tile path: many tiles → merge into coarser requests ──
      // Group needed tiles into mega-tiles (MEGA_TILE_SIZE° grid)
      const megaTiles = new Map<
        string,
        { minLat: number; minLng: number; maxLat: number; maxLng: number; tileKeys: string[] }
      >();

      for (const tile of needed) {
        const mLat = Math.floor(tile.minLat / MEGA_TILE_SIZE) * MEGA_TILE_SIZE;
        const mLng = Math.floor(tile.minLng / MEGA_TILE_SIZE) * MEGA_TILE_SIZE;
        const mKey = `mega:${mLat.toFixed(2)},${mLng.toFixed(2)}`;
        let mega = megaTiles.get(mKey);
        if (!mega) {
          mega = {
            minLat: mLat,
            minLng: mLng,
            maxLat: mLat + MEGA_TILE_SIZE,
            maxLng: mLng + MEGA_TILE_SIZE,
            tileKeys: [],
          };
          megaTiles.set(mKey, mega);
        }
        mega.tileKeys.push(tile.key);
      }

      // Fetch mega-tiles with concurrency limit of 2 (larger requests)
      const megaArr = Array.from(megaTiles.values());
      const megaBatches: (typeof megaArr)[] = [];
      for (let i = 0; i < megaArr.length; i += 2) {
        megaBatches.push(megaArr.slice(i, i + 2));
      }

      for (const batch of megaBatches) {
        await Promise.all(
          batch.map(async (mega) => {
            // Skip if all constituent tiles already fetched
            if (mega.tileKeys.every((k) => fetchedTiles.has(k))) return;

            try {
              const lines = await fetchTile(mega.minLat, mega.minLng, mega.maxLat, mega.maxLng);
              // Store under a mega key and mark all fine-grained tiles as fetched
              const megaKey = `mega:${mega.minLat.toFixed(2)},${mega.minLng.toFixed(2)}`;
              tileData.set(megaKey, lines);
              for (const tk of mega.tileKeys) {
                if (!fetchedTiles.has(tk)) {
                  fetchedTiles.add(tk);
                  tileData.set(tk, []);
                }
              }
            } catch {
              // Will retry on next viewport update
            }
          }),
        );

        if (onProgress) {
          onProgress(getAllCachedLines());
        }
      }
    }
  }

  return getAllCachedLines();
}

/** Collect and deduplicate all cached lines across all tiles. */
function getAllCachedLines(): TransitRouteLine[] {
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
  return getAllCachedLines();
}

/** Check if we have any cached transit data. */
export function hasCachedLines(): boolean {
  return tileData.size > 0;
}

// ── Background metro-area pre-warm ──────────────────────────────────

const PREWARM_KEY = '__prewarm__';
let prewarmInFlight: Promise<void> | null = null;
let prewarmAbort: AbortController | null = null;

/** Cancel any in-flight prewarm request to free the Overpass connection. */
function cancelPrewarm(): void {
  if (prewarmAbort) {
    prewarmAbort.abort();
    prewarmAbort = null;
  }
  prewarmInFlight = null;
}

/**
 * Pre-warm the transit tile cache for the user's metro area on app start.
 *
 * Makes ONE Overpass request covering ±0.10° lat × ±0.10° lng (~11 km)
 * around the user's location, parses it identically to the per-tile fetcher,
 * and stores the results under a dedicated cache key. All fine-grained
 * 0.05° tiles within the bbox are marked as "fetched" (with empty arrays)
 * so they won't be re-queried when the transit layer is toggled on.
 *
 * This is fire-and-forget: call without await from the startup location effect.
 * Silently no-ops if data is already cached or if Overpass is unavailable.
 */
export async function prewarmTransitCache(lat: number, lng: number): Promise<void> {
  // Skip if already prewarmed or data exists from normal tile fetching
  if (tileData.has(PREWARM_KEY) || hasCachedLines()) return;
  // Prevent concurrent prewarm calls
  if (prewarmInFlight) return prewarmInFlight;

  prewarmInFlight = (async () => {
    const PAD_LAT = 0.1; // ~11 km north/south (kept small to avoid Overpass 504/timeouts in dense metro areas)
    const PAD_LNG = 0.1; // ~8 km east/west at mid-latitudes
    const minLat = lat - PAD_LAT;
    const minLng = lng - PAD_LNG;
    const maxLat = lat + PAD_LAT;
    const maxLng = lng + PAD_LNG;

    const bbox = `${minLat.toFixed(4)},${minLng.toFixed(4)},${maxLat.toFixed(4)},${maxLng.toFixed(4)}`;
    const query = `[out:json][timeout:30];
(
  relation["route"~"^(subway|light_rail|train|tram|monorail)$"](${bbox});
)->.routes;
.routes out body geom;
node(r.routes:"stop");
out body;
node(r.routes:"platform");
out body;
node["railway"~"station|stop"]["name"](${bbox});
out body;`;

    const controller = new AbortController();
    prewarmAbort = controller;
    const timer = setTimeout(() => controller.abort(), 35_000);

    try {
      const res = await fetch(OVERPASS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      });
      if (!res.ok) return;

      const data = (await res.json()) as { elements: (OverpassRelation | StopNode)[] };

      const stopNodes = new Map<number, { name: string; lat: number; lon: number }>();
      const relations: OverpassRelation[] = [];
      for (const el of data.elements) {
        if (el.type === 'relation') {
          relations.push(el as OverpassRelation);
        } else if (el.type === 'node') {
          const node = el as StopNode;
          if (node.tags?.name && node.lat != null && node.lon != null) {
            stopNodes.set(node.id, { name: node.tags.name, lat: node.lat, lon: node.lon });
          }
        }
      }

      const lines: TransitRouteLine[] = [];
      for (const rel of relations) {
        const line = relationToLine(rel, stopNodes);
        if (line) lines.push(line);
      }

      // Store deduplicated results under the prewarm key
      tileData.set(PREWARM_KEY, deduplicateLines(lines));

      // Mark all fine-grained tiles in the bbox as already fetched.
      // Empty arrays so getCachedLines() doesn't double-count; the actual
      // data lives under PREWARM_KEY and is included via getCachedLines().
      for (const tile of tilesForBounds(minLat, minLng, maxLat, maxLng)) {
        if (!fetchedTiles.has(tile.key)) {
          fetchedTiles.add(tile.key);
          tileData.set(tile.key, []);
        }
      }
    } catch {
      // Silently ignore — prewarm failure is non-critical
    } finally {
      clearTimeout(timer);
      prewarmAbort = null;
      prewarmInFlight = null;
    }
  })();

  return prewarmInFlight;
}

/**
 * Instant search through cached transit stops by name.
 * Returns deduplicated stops sorted by prefix match, then alphabetically.
 */
export function searchCachedStations(
  query: string,
): Array<{ name: string; lat: number; lon: number }> {
  if (!query.trim()) return [];
  const q = query.toLowerCase();
  const seen = new Set<string>();
  const results: Array<{ name: string; lat: number; lon: number }> = [];

  for (const lines of tileData.values()) {
    for (const line of lines) {
      for (const stop of line.stops) {
        const key = `${stop.name}:${(stop.lat * 200).toFixed(0)},${(stop.lon * 200).toFixed(0)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (stop.name.toLowerCase().includes(q)) {
          results.push({ name: stop.name, lat: stop.lat, lon: stop.lon });
        }
      }
    }
  }

  return results
    .sort((a, b) => {
      const ap = a.name.toLowerCase().startsWith(q) ? 0 : 1;
      const bp = b.name.toLowerCase().startsWith(q) ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return a.name.localeCompare(b.name);
    })
    .slice(0, 15);
}

/**
 * Search for transit stations via Overpass API within ~50 km of a point.
 * Fallback for when cached stations don't have enough matches.
 */
export async function searchStationsOverpass(
  query: string,
  nearLat: number,
  nearLon: number,
): Promise<Array<{ name: string; lat: number; lon: number }>> {
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!escaped) return [];

  const bbox = `${nearLat - 0.5},${nearLon - 1},${nearLat + 0.5},${nearLon + 1}`;
  const q = `[out:json][timeout:10];
node["railway"~"^(station|halt|stop)$"]["name"~"${escaped}",i](${bbox});
out body;`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);

  try {
    const res = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(q)}`,
      signal: controller.signal,
    });
    if (!res.ok) return [];

    const data = (await res.json()) as {
      elements: Array<{ tags?: Record<string, string>; lat: number; lon: number }>;
    };
    return data.elements
      .filter((e) => e.tags?.name)
      .map((e) => ({ name: e.tags!.name!, lat: e.lat, lon: e.lon }));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
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

      // Deduplicate by line identity, not by individual stopping pattern.
      // MBTA (and other agencies) store each direction / stopping pattern as
      // a separate OSM relation with unique names like
      // "Inbound: Foxboro => Forest Hills => South Station".
      // We collapse those into a single line entry using the operator + ref
      // (e.g. "MBTA::Franklin") or, failing that, by stripping direction /
      // stop lists from the name.
      const operator = tags.operator ?? tags.network ?? '';
      let lineKey: string;
      if (ref) {
        lineKey = `${operator}::${ref}`;
      } else if (name) {
        // Strip "Inbound: " / "Outbound: " prefix and stop lists ( "A => B => C")
        const stripped = name
          .replace(/^(Inbound|Outbound|Northbound|Southbound|Eastbound|Westbound)\s*:\s*/i, '')
          .replace(/\s*=>\s*.*/i, '')
          .trim();
        lineKey = `${operator}::${stripped || name}`;
      } else {
        lineKey = `${operator}::${name ?? ''}`;
      }

      if (seen.has(lineKey)) continue;
      seen.add(lineKey);

      // For display, prefer a clean line name over the raw OSM name
      let displayName = name;
      if (name && /=>/.test(name)) {
        // Extract the line name from operator tag or ref
        displayName = tags['public_transport:version'] === '2' ? (ref ?? name) : (ref ?? name);
      }

      result.push({
        ref,
        name: displayName,
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

// ── Local transit route planner ─────────────────────────────────────

interface LocalTransitRoute {
  /** The transit line serving both stations directly */
  line: TransitRouteLine;
  /** Index of origin stop in line.stops */
  originIdx: number;
  /** Index of destination stop in line.stops */
  destIdx: number;
  /** Number of intermediate stops (excluding origin and destination) */
  intermediateStops: number;
  /** Estimated travel time in seconds */
  estimatedSeconds: number;
  /** Estimated distance in meters */
  estimatedMeters: number;
}

/** Haversine distance in meters. */
function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Approximate match: returns true when stop is considered the same station. */
function matchesStop(stop: TransitRouteLineStop, lat: number, lon: number, name?: string): boolean {
  const dist = haversineMeters(stop.lat, stop.lon, lat, lon);

  if (name) {
    const stopLower = stop.name.toLowerCase();
    const queryLower = name.toLowerCase();
    // Exact match
    if (stopLower === queryLower) return true;
    // One fully contains the other AND within 1.5 km (same station complex)
    const nameMatch =
      stopLower === queryLower ||
      stopLower.startsWith(queryLower + ' ') ||
      stopLower.startsWith(queryLower + '\u2013') || // en dash (e.g. "Jamaica–179th")
      stopLower.startsWith(queryLower + '-') ||
      queryLower.startsWith(stopLower + ' ') ||
      queryLower.startsWith(stopLower + '\u2013') ||
      queryLower.startsWith(stopLower + '-');
    // Strict: exact name must be within 400 m, partial within 200 m
    if (stopLower === queryLower && dist < 400) return true;
    if (nameMatch && dist < 200) return true;
    return false;
  }

  // No name — pure proximity (e.g. "Your location" → nearest stop)
  return dist < 400;
}

/**
 * Plan transit routes between two station points using only cached line data.
 * Finds direct routes (single line serving both stops) and returns them
 * sorted by estimated travel time. No external API needed.
 */
export function planLocalTransitRoute(
  originLat: number,
  originLon: number,
  originName: string | undefined,
  destLat: number,
  destLon: number,
  destName: string | undefined,
): LocalTransitRoute[] {
  const lines = getCachedLines();
  const directRoutes: LocalTransitRoute[] = [];

  for (const line of lines) {
    if (line.stops.length < 2) continue;

    const originIdxs: number[] = [];
    const destIdxs: number[] = [];

    for (let i = 0; i < line.stops.length; i++) {
      if (matchesStop(line.stops[i], originLat, originLon, originName)) {
        originIdxs.push(i);
      }
      if (matchesStop(line.stops[i], destLat, destLon, destName)) {
        destIdxs.push(i);
      }
    }

    for (const oi of originIdxs) {
      for (const di of destIdxs) {
        if (oi === di) continue;
        const steps = Math.abs(di - oi);
        let totalDist = 0;
        const lo = Math.min(oi, di);
        const hi = Math.max(oi, di);
        for (let s = lo; s < hi; s++) {
          totalDist += haversineMeters(
            line.stops[s].lat,
            line.stops[s].lon,
            line.stops[s + 1].lat,
            line.stops[s + 1].lon,
          );
        }

        // Estimate travel time from distance + stop count.
        // Commuter rail averages ~60 km/h, subway ~30 km/h, tram/bus ~20 km/h.
        const avgSpeedMs =
          line.mode === 'RAIL'
            ? 16.7 // ~60 km/h
            : line.mode === 'SUBWAY'
              ? 8.3 // ~30 km/h
              : 5.6; // ~20 km/h
        // Base travel = distance / speed, plus ~30 s dwell per intermediate stop
        const travelSeconds = totalDist / avgSpeedMs;
        const dwellSeconds = (steps - 1) * 30;
        const estimatedSeconds = Math.round(travelSeconds + dwellSeconds);

        directRoutes.push({
          line,
          originIdx: oi,
          destIdx: di,
          intermediateStops: steps - 1,
          estimatedSeconds,
          estimatedMeters: Math.round(totalDist),
        });
      }
    }
  }

  // Deduplicate: keep the best route per line
  const bestPerLine = new Map<string, LocalTransitRoute>();
  for (const r of directRoutes) {
    const existing = bestPerLine.get(r.line.id);
    if (!existing || r.intermediateStops < existing.intermediateStops) {
      bestPerLine.set(r.line.id, r);
    }
  }

  return Array.from(bestPerLine.values()).sort((a, b) => a.estimatedSeconds - b.estimatedSeconds);
}

/**
 * Convert a LocalTransitRoute into an OtpItinerary shape so the existing
 * UI components can render it without changes.
 */
export function localRouteToItinerary(
  route: LocalTransitRoute,
): import('../../models/transit').OtpItinerary {
  const now = new Date();
  const start = now.toISOString();
  const end = new Date(now.getTime() + route.estimatedSeconds * 1000).toISOString();

  const lo = Math.min(route.originIdx, route.destIdx);
  const hi = Math.max(route.originIdx, route.destIdx);
  const originStop = route.line.stops[route.originIdx];
  const destStop = route.line.stops[route.destIdx];

  const intermediates: Array<{ name: string; lat: number; lon: number }> = [];
  if (route.originIdx < route.destIdx) {
    for (let i = lo + 1; i < hi; i++) {
      intermediates.push({
        name: route.line.stops[i].name,
        lat: route.line.stops[i].lat,
        lon: route.line.stops[i].lon,
      });
    }
  } else {
    for (let i = hi - 1; i > lo; i--) {
      intermediates.push({
        name: route.line.stops[i].name,
        lat: route.line.stops[i].lat,
        lon: route.line.stops[i].lon,
      });
    }
  }

  return {
    start,
    end,
    duration: route.estimatedSeconds,
    walkDistance: 0,
    waitingTime: 0,
    transfers: 0,
    legs: [
      {
        mode: route.line.mode as import('../../models/transit').LegMode,
        from: {
          name: originStop.name,
          lat: originStop.lat,
          lon: originStop.lon,
        },
        to: {
          name: destStop.name,
          lat: destStop.lat,
          lon: destStop.lon,
        },
        startTime: now.getTime(),
        endTime: now.getTime() + route.estimatedSeconds * 1000,
        duration: route.estimatedSeconds,
        distance: route.estimatedMeters,
        route: {
          gtfsId: route.line.id,
          shortName: route.line.ref,
          longName: route.line.name,
          color: route.line.color,
          mode: route.line.mode,
        },
        headsign: destStop.name,
        intermediateStops: intermediates,
        legGeometry: { points: '' },
        realTime: false,
      },
    ],
  };
}
