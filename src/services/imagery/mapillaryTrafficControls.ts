/**
 * Mapillary traffic-control map features.
 *
 * Mapillary's computer vision classifies objects in street-level imagery and
 * fuses detections from several images into point map features. Two classes
 * matter for driving: stop signs (`regulatory--stop--*`) and traffic lights
 * (`object--traffic-light--*`).
 *
 * Two consumers:
 *   - The navigation map draws stop-sign / traffic-light icons along the route
 *     ahead (`TrafficControlLayer`).
 *   - `hassleTurns` uses the same data to prefer routes whose turns are managed
 *     by a signal or stop sign.
 *
 * Coverage caveat: a missing detection only means "no control" where Mapillary
 * actually has imagery. `getTrafficControlStateAt` therefore also checks for
 * street-level imagery at the point, and returns `hasCoverage: false` when
 * there is none, so callers never penalise an intersection the data cannot see.
 *
 * Mapillary is an opt-in exception to the no-corporate-cloud rule (see
 * `streetViewService`), so every function here is a no-op without a token.
 *
 * API notes:
 *   - Search bboxes must be small; cells are 0.01° per side (~1.1 km).
 *   - `object_values` accepts comma-separated wildcards.
 *   - Responses are cached for 10 minutes per cell/point — Mapillary map
 *     features change on the order of months, not seconds.
 */

import { MAPILLARY_TOKEN } from '../../constants/config';
import { haversineMeters } from '../../utils/routeSnap';

const GRAPH_ROOT = 'https://graph.mapillary.com';

/** Mapillary object values, wildcarded to cover every regional variant. */
const STOP_SIGN_VALUES = 'regulatory--stop--*';
const TRAFFIC_LIGHT_VALUES = 'object--traffic-light--*';

const REQUEST_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_REQUESTS_IN_FLIGHT = 4;
const FEATURE_LIMIT = 2_000;

/** Cell size for corridor queries. Comfortably inside Mapillary's bbox limit. */
const CELL_DEG = 0.01;
/** Upper bound on cells per route slice so a long trip cannot fan out. */
const MAX_CELLS_PER_ROUTE = 24;

/** Default radius for associating a control with a turn. */
export const TRAFFIC_CONTROL_MATCH_RADIUS_METERS = 45;
/** Radius used when checking whether Mapillary has imagery at a point. */
const COVERAGE_RADIUS_METERS = 60;

export type TrafficControlKind = 'stop-sign' | 'traffic-light';

export interface TrafficControl {
  id: string;
  kind: TrafficControlKind;
  lat: number;
  lng: number;
  /** Raw Mapillary object value, kept for debugging/attribution. */
  objectValue: string;
}

export interface TrafficControlState {
  lat: number;
  lng: number;
  /** True when Mapillary has street-level imagery near this point. */
  hasCoverage: boolean;
  /** Controls found within the query radius. */
  controls: TrafficControl[];
}

/** `[minLng, minLat, maxLng, maxLat]` — the order Mapillary expects. */
export type MapillaryBbox = [number, number, number, number];

export interface TrafficControlCell {
  latIndex: number;
  lngIndex: number;
  bbox: MapillaryBbox;
}

/** True when a Mapillary client token is configured. */
export function isTrafficControlDataAvailable(): boolean {
  return MAPILLARY_TOKEN.trim().length > 0;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Classify one Mapillary object value, or null when it is not a control. */
export function trafficControlKind(objectValue: string): TrafficControlKind | null {
  if (objectValue.startsWith('regulatory--stop--')) return 'stop-sign';
  if (objectValue.startsWith('object--traffic-light--')) return 'traffic-light';
  return null;
}

/**
 * Normalize a `/map_features` payload into controls.
 * Malformed entries are dropped rather than failing the whole batch.
 */
export function normalizeTrafficControls(payload: unknown): TrafficControl[] {
  const data = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return [];

  const controls: TrafficControl[] = [];
  const seen = new Set<string>();

  for (const entry of data) {
    if (!entry || typeof entry !== 'object') continue;
    const raw = entry as Record<string, unknown>;
    const id = typeof raw.id === 'string' ? raw.id : null;
    const objectValue = typeof raw.object_value === 'string' ? raw.object_value : '';
    const kind = trafficControlKind(objectValue);
    if (!id || !kind || seen.has(id)) continue;

    const geometry = raw.geometry as { type?: unknown; coordinates?: unknown } | undefined;
    if (!geometry || geometry.type !== 'Point' || !Array.isArray(geometry.coordinates)) continue;
    const lng = asFiniteNumber(geometry.coordinates[0]);
    const lat = asFiniteNumber(geometry.coordinates[1]);
    if (lng == null || lat == null) continue;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;

    seen.add(id);
    controls.push({ id, kind, lat, lng, objectValue });
  }

  return controls;
}

/** Build a square bbox around a point. */
export function bboxAround(lat: number, lng: number, radiusMeters: number): MapillaryBbox {
  const latDelta = radiusMeters / 111_320;
  // Clamp the longitude scale so polar coordinates cannot explode the bbox.
  const lngScale = Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  const lngDelta = radiusMeters / (111_320 * lngScale);
  return [lng - lngDelta, lat - latDelta, lng + lngDelta, lat + latDelta];
}

/**
 * Cells crossed by an ordered polyline, in travel order.
 * Capped so a very long route cannot turn into hundreds of requests.
 */
export function cellsForCoordinates(
  coords: ReadonlyArray<readonly [number, number]>,
  maxCells = MAX_CELLS_PER_ROUTE,
): TrafficControlCell[] {
  const cells: TrafficControlCell[] = [];
  const seen = new Set<string>();

  for (const [lng, lat] of coords) {
    const latIndex = Math.floor(lat / CELL_DEG);
    const lngIndex = Math.floor(lng / CELL_DEG);
    const key = `${latIndex}:${lngIndex}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cells.push({
      latIndex,
      lngIndex,
      bbox: [
        lngIndex * CELL_DEG,
        latIndex * CELL_DEG,
        (lngIndex + 1) * CELL_DEG,
        (latIndex + 1) * CELL_DEG,
      ],
    });
    if (cells.length >= maxCells) break;
  }

  return cells;
}

async function requestJson(url: string): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function featureQuery(bbox: MapillaryBbox): string {
  const params = [
    `access_token=${encodeURIComponent(MAPILLARY_TOKEN)}`,
    `fields=${encodeURIComponent('id,object_value,geometry')}`,
    `object_values=${encodeURIComponent(`${STOP_SIGN_VALUES},${TRAFFIC_LIGHT_VALUES}`)}`,
    `bbox=${bbox.map((value) => value.toFixed(6)).join(',')}`,
    `limit=${FEATURE_LIMIT}`,
  ];
  return `${GRAPH_ROOT}/map_features?${params.join('&')}`;
}

function imageryQuery(bbox: MapillaryBbox): string {
  const params = [
    `access_token=${encodeURIComponent(MAPILLARY_TOKEN)}`,
    `fields=${encodeURIComponent('id')}`,
    `bbox=${bbox.map((value) => value.toFixed(6)).join(',')}`,
    'limit=1',
  ];
  return `${GRAPH_ROOT}/images?${params.join('&')}`;
}

/** Controls in a bbox, or null when the request failed. */
async function fetchControlsForBbox(bbox: MapillaryBbox): Promise<TrafficControl[] | null> {
  const payload = await requestJson(featureQuery(bbox));
  if (payload === null) return null;
  return normalizeTrafficControls(payload);
}

/** Whether imagery exists in a bbox, or null when the request failed. */
async function fetchCoverageForBbox(bbox: MapillaryBbox): Promise<boolean | null> {
  const payload = await requestJson(imageryQuery(bbox));
  if (payload === null) return null;
  const data = (payload as { data?: unknown }).data;
  return Array.isArray(data) && data.length > 0;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const cellCache = new Map<string, CacheEntry<TrafficControl[]>>();
const cellInFlight = new Map<string, Promise<TrafficControl[] | null>>();
const pointStateCache = new Map<string, CacheEntry<TrafficControlState>>();
const pointStateInFlight = new Map<string, Promise<TrafficControlState | null>>();

async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

async function loadCell(cell: TrafficControlCell): Promise<TrafficControl[] | null> {
  const key = `${cell.latIndex}:${cell.lngIndex}`;
  const cached = cellCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const existing = cellInFlight.get(key);
  if (existing) return existing;

  const promise = fetchControlsForBbox(cell.bbox)
    .then((controls) => {
      if (controls !== null) {
        cellCache.set(key, { value: controls, expiresAt: Date.now() + CACHE_TTL_MS });
      }
      return controls;
    })
    .finally(() => cellInFlight.delete(key));

  cellInFlight.set(key, promise);
  return promise;
}

/**
 * Controls in the cells crossed by `coords`. Failed cells are skipped so a
 * partial answer still lights up the map; an empty result means "none found".
 */
export async function fetchTrafficControlsAlongRoute(
  coords: ReadonlyArray<readonly [number, number]>,
): Promise<TrafficControl[]> {
  if (!isTrafficControlDataAvailable() || coords.length === 0) return [];

  const cells = cellsForCoordinates(coords);
  const results = await mapWithLimit(cells, MAX_REQUESTS_IN_FLIGHT, loadCell);

  const byId = new Map<string, TrafficControl>();
  for (const controls of results) {
    if (!controls) continue;
    for (const control of controls) byId.set(control.id, control);
  }
  return [...byId.values()];
}

/**
 * Traffic-control state at one intersection.
 *
 * Returns null when the data could not be fetched, so callers must not read a
 * failed request as "no controls here". A null result is never cached.
 */
export async function getTrafficControlStateAt(
  lat: number,
  lng: number,
  radiusMeters = TRAFFIC_CONTROL_MATCH_RADIUS_METERS,
): Promise<TrafficControlState | null> {
  if (!isTrafficControlDataAvailable()) return null;

  const key = `${lat.toFixed(4)}:${lng.toFixed(4)}`;
  const cached = pointStateCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const existing = pointStateInFlight.get(key);
  if (existing) return existing;

  const promise = (async (): Promise<TrafficControlState | null> => {
    const [hasCoverage, controls] = await Promise.all([
      fetchCoverageForBbox(bboxAround(lat, lng, COVERAGE_RADIUS_METERS)),
      fetchControlsForBbox(bboxAround(lat, lng, radiusMeters)),
    ]);
    if (hasCoverage === null || controls === null) return null;

    const state: TrafficControlState = {
      lat,
      lng,
      hasCoverage,
      controls: controls.filter(
        (control) => haversineMeters([control.lng, control.lat], [lng, lat]) <= radiusMeters,
      ),
    };
    pointStateCache.set(key, { value: state, expiresAt: Date.now() + CACHE_TTL_MS });
    return state;
  })().finally(() => pointStateInFlight.delete(key));

  pointStateInFlight.set(key, promise);
  return promise;
}

/**
 * Distance from a point to the nearest segment of a polyline, in meters.
 * Equirectangular approximation — accurate enough at the tens-of-meters scale
 * used to decide whether a sign belongs to the route.
 */
function distanceToPathMeters(
  lat: number,
  lng: number,
  coords: ReadonlyArray<readonly [number, number]>,
): number {
  if (coords.length === 0) return Infinity;
  if (coords.length === 1) return haversineMeters([lng, lat], [coords[0][0], coords[0][1]]);

  let best = Infinity;
  for (let i = 1; i < coords.length; i++) {
    const [ax, ay] = coords[i - 1];
    const [bx, by] = coords[i];
    const latRef = (((ay + by) / 2) * Math.PI) / 180;
    const kx = 111_320 * Math.cos(latRef);
    const ky = 111_320;
    const px = (lng - ax) * kx;
    const py = (lat - ay) * ky;
    const dx = (bx - ax) * kx;
    const dy = (by - ay) * ky;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, (px * dx + py * dy) / lengthSq));
    const ex = px - t * dx;
    const ey = py - t * dy;
    const distance = Math.sqrt(ex * ex + ey * ey);
    if (distance < best) best = distance;
  }
  return best;
}

/**
 * Keep only controls that sit on the route itself.
 * A cell is ~1.1 km square and often contains a parallel street with its own
 * signals; drawing those on the navigation map would be misleading.
 */
export function controlsNearPath(
  controls: readonly TrafficControl[],
  coords: ReadonlyArray<readonly [number, number]>,
  maxMeters = 35,
): TrafficControl[] {
  if (coords.length === 0) return [];
  return controls.filter(
    (control) => distanceToPathMeters(control.lat, control.lng, coords) <= maxMeters,
  );
}

/** Test-only: drop every cached response. */
export function resetTrafficControlCachesForTests(): void {
  cellCache.clear();
  cellInFlight.clear();
  pointStateCache.clear();
  pointStateInFlight.clear();
}
