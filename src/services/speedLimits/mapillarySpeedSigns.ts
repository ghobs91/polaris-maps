/**
 * Mapillary traffic-sign speed limits.
 *
 * Mapillary derives sign detections from street-level imagery and exposes them
 * as point features. They are the only open source that can fill the gaps where
 * OSM has no `maxspeed` — which is exactly why the navigation sign goes blank on
 * most US roads.
 *
 * Three API constraints shape this module (Mapillary Graph API v4, 2026-10):
 *
 * - `bbox` queries against `/map_features` must be smaller than 0.01 degrees
 *   square. A whole-route corridor query is rejected, so callers fetch a small
 *   box ahead of the car and rely on {@link SpeedLimitSignCache}.
 * - The numeric value carries no unit: "50" is 50 mph in the US and 50 km/h in
 *   Germany. The caller supplies the country's convention; deriving it from the
 *   user's display preference would read a 50 km/h zone as 50 mph.
 * - Detections are CC-BY-SA. Anything that surfaces one owes Mapillary
 *   attribution, as the street-level imagery viewer already does.
 */

import { MAPILLARY_TOKEN } from '../../constants/config';
import { haversineMeters } from '../../utils/routeSnap';

// ── Types ───────────────────────────────────────────────────────────────

export type SpeedUnit = 'mph' | 'km/h';

/**
 * Visible credit owed when a detection is on screen. Mapillary's detections are
 * CC-BY-SA, and the sign can be displayed for a whole trip, so the credit sits
 * with the sign rather than in a transient detail view.
 */
export const MAPILLARY_SPEED_LIMIT_ATTRIBUTION = 'Limits © Mapillary';

/** A detected posted limit, normalized to the app's internal mph. */
export interface SpeedLimitSign {
  id: string;
  lat: number;
  lng: number;
  /** Posted limit in mph, converted from the sign's own unit. */
  limitMph: number;
  /** When the sign was last observed, epoch milliseconds. */
  seenAt?: number;
}

export interface SpeedSignBbox {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Mapillary rejects boxes at or above this span; callers must tile or shrink. */
export const MAX_BBOX_SPAN_DEG = 0.01;

/** Detections further than this from the car are not "the road you're on". */
export const DEFAULT_SIGN_MATCH_METERS = 25;

/** The API's own value token for a posted maximum. */
const MAX_SPEED_VALUE = 'regulatory--maximum-speed-limit-';

// ── Units ───────────────────────────────────────────────────────────────

/**
 * Countries that post limits in mph. Everything else is metric — including the
 * UK, which is the one European country that signs roads in mph.
 */
const MPH_COUNTRIES = new Set(['US', 'GB', 'LR', 'MM']);

/** Unit a country's speed-limit signs are written in. */
export function speedUnitForCountry(countryCode: string | null | undefined): SpeedUnit {
  const code = (countryCode ?? '').trim().toUpperCase();
  return MPH_COUNTRIES.has(code) ? 'mph' : 'km/h';
}

/**
 * Country prefix of an app region id (`us-ny-new-york` → `US`).
 *
 * Region ids are the only geography the app carries for a downloaded extract;
 * they follow `<iso2>-<subdivision>-<place>`. Returns null when the id does not
 * start with a two-letter code, so callers can fall back rather than guess.
 */
export function countryCodeFromRegionId(regionId: string | null | undefined): string | null {
  const match = /^([a-z]{2})-/i.exec(regionId ?? '');
  return match ? match[1].toUpperCase() : null;
}

// ── Parsing ─────────────────────────────────────────────────────────────

/**
 * Posted limit from a Mapillary `object_value`, in the sign's own unit.
 *
 * Only legal maxima count. Advisory plates (`complementary--…`, the yellow
 * "suggested" signs) and minimum-speed signs are deliberately rejected: showing
 * an advisory as the posted limit is a citation-grade error, not a cosmetic one.
 *
 * Values look like `regulatory--maximum-speed-limit-50--g1`, where the trailing
 * `g{n}` is the sign's facing variant.
 */
export function parseMaxspeedSignValue(objectValue: unknown): number | null {
  if (typeof objectValue !== 'string' || !objectValue.startsWith(MAX_SPEED_VALUE)) return null;

  const match = /^(\d{1,3})(?:--g\d+)?$/.exec(objectValue.slice(MAX_SPEED_VALUE.length));
  if (!match) return null;

  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Convert a limit in the sign's unit to the app's internal mph. */
export function signLimitToMph(value: number, unit: SpeedUnit): number {
  return unit === 'mph' ? value : value / 1.60934;
}

/** Normalize a Mapillary `/map_features` response into signs in mph. */
export function normalizeSpeedLimitSigns(payload: unknown, unit: SpeedUnit): SpeedLimitSign[] {
  const data = (payload as { data?: unknown[] })?.data;
  if (!Array.isArray(data)) return [];

  const signs: SpeedLimitSign[] = [];
  for (const entry of data) {
    const feature = entry as {
      id?: string;
      object_value?: string;
      geometry?: { coordinates?: number[] };
      last_seen_at?: string | number;
    };
    const coords = feature.geometry?.coordinates;
    const raw = parseMaxspeedSignValue(feature.object_value);
    if (!feature.id || !coords || coords.length < 2 || raw == null) continue;

    signs.push({
      id: `mapillary:${feature.id}`,
      lng: coords[0],
      lat: coords[1],
      limitMph: signLimitToMph(raw, unit),
      seenAt: toEpochMillis(feature.last_seen_at),
    });
  }
  return signs;
}

/** Mapillary returns ISO 8601 here; tolerate a numeric timestamp too. */
function toEpochMillis(value: string | number | undefined): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? (value < 1e12 ? value * 1000 : value) : undefined;
  }
  if (typeof value !== 'string') return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

// ── Fetch ───────────────────────────────────────────────────────────────

/** True when a token is configured; without one the feature stays off. */
export function isMapillarySpeedSignsConfigured(token: string = MAPILLARY_TOKEN): boolean {
  return token.trim().length > 0;
}

/** bbox span in degrees, largest side first. */
export function bboxSpanDeg(bbox: SpeedSignBbox): number {
  return Math.max(Math.abs(bbox.east - bbox.west), Math.abs(bbox.north - bbox.south));
}

/**
 * `/map_features` URL for one box.
 *
 * The token goes in the query string because that is the form the Graph API
 * accepts for this endpoint; it is a read-only client token, not a user token.
 */
export function buildSpeedSignsUrl(bbox: SpeedSignBbox, token: string): string {
  const fields = 'id,object_value,geometry,last_seen_at';
  const box = [bbox.west, bbox.south, bbox.east, bbox.north].join(',');
  return (
    `https://graph.mapillary.com/map_features?access_token=${encodeURIComponent(token)}` +
    `&fields=${fields}&object_types=traffic_sign&bbox=${box}&limit=200`
  );
}

/**
 * Fetch detected limits inside one box.
 *
 * Returns [] rather than throwing when unconfigured, oversized, or the network
 * fails: this is a best-effort enrichment behind the routing engine's own data,
 * and a navigation screen must never break because a sign lookup did.
 */
export async function fetchSpeedLimitSigns(
  bbox: SpeedSignBbox,
  unit: SpeedUnit,
  token: string = MAPILLARY_TOKEN,
): Promise<SpeedLimitSign[]> {
  if (!isMapillarySpeedSignsConfigured(token)) return [];
  if (bboxSpanDeg(bbox) >= MAX_BBOX_SPAN_DEG) return [];

  try {
    const response = await fetch(buildSpeedSignsUrl(bbox, token));
    if (!response.ok) return [];
    return normalizeSpeedLimitSigns(await response.json(), unit);
  } catch {
    return [];
  }
}

// ── Matching ────────────────────────────────────────────────────────────

/**
 * Posted limit of the nearest cached sign, or null when none is close enough.
 *
 * Proximity only: detecting which sign faces which carriageway needs the
 * detection's bearing, which the API does not return here. A 25 m radius keeps
 * the match on the same roadway without silently borrowing the opposite
 * direction's limit on a divided highway.
 */
export function findNearestSpeedLimitMph(
  signs: readonly SpeedLimitSign[],
  lng: number,
  lat: number,
  maxDistanceM: number = DEFAULT_SIGN_MATCH_METERS,
): number | null {
  let best: SpeedLimitSign | null = null;
  let bestDistance = maxDistanceM;

  for (const sign of signs) {
    const distance = haversineMeters([lng, lat], [sign.lng, sign.lat]);
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = sign;
    }
  }
  return best?.limitMph ?? null;
}

/** Box of half-span `spanDeg` around a point. */
export function bboxAround(lng: number, lat: number, spanDeg: number): SpeedSignBbox {
  return {
    west: lng - spanDeg / 2,
    south: lat - spanDeg / 2,
    east: lng + spanDeg / 2,
    north: lat + spanDeg / 2,
  };
}

export interface SpeedSignFetcher {
  (bbox: SpeedSignBbox, unit: SpeedUnit): Promise<SpeedLimitSign[]>;
}

export interface SpeedLimitSignCacheOptions {
  fetchSigns: SpeedSignFetcher;
  /** Box span; must stay below {@link MAX_BBOX_SPAN_DEG}. */
  spanDeg?: number;
  /** Travel distance before another box is worth fetching. */
  refetchDistanceM?: number;
  /** Cap on retained signs, oldest-fetched first out. */
  maxSigns?: number;
  matchDistanceM?: number;
}

const DEFAULT_SPAN_DEG = 0.008; // ~800 m; inside the API's 0.01 limit
const DEFAULT_REFETCH_METERS = 400;

/**
 * In-memory sign cache for one trip.
 *
 * Boxes are fetched ahead of the car and merged, so a limit stays available for
 * the metres between fetches instead of blinking in and out with network
 * latency. Deliberately memory-only: detections are cheap to re-fetch, and a
 * persisted copy would need an eviction policy and a licence note for data we
 * do not own.
 */
export class SpeedLimitSignCache {
  private signs: SpeedLimitSign[] = [];
  private lastFetch: [number, number] | null = null;
  private inFlight = false;
  private readonly fetchSigns: SpeedSignFetcher;
  private readonly spanDeg: number;
  private readonly refetchDistanceM: number;
  private readonly maxSigns: number;
  private readonly matchDistanceM: number;

  constructor(options: SpeedLimitSignCacheOptions) {
    this.fetchSigns = options.fetchSigns;
    this.spanDeg = Math.min(options.spanDeg ?? DEFAULT_SPAN_DEG, MAX_BBOX_SPAN_DEG * 0.99);
    this.refetchDistanceM = options.refetchDistanceM ?? DEFAULT_REFETCH_METERS;
    this.maxSigns = options.maxSigns ?? 500;
    this.matchDistanceM = options.matchDistanceM ?? DEFAULT_SIGN_MATCH_METERS;
  }

  /** Best cached limit at the car's position, without touching the network. */
  limitMphAt(lng: number, lat: number): number | null {
    return findNearestSpeedLimitMph(this.signs, lng, lat, this.matchDistanceM);
  }

  /** Signs currently held, for tests and diagnostics. */
  get size(): number {
    return this.signs.length;
  }

  /**
   * Fetch a fresh box when the car has moved far enough, and merge it in.
   * Safe to call every tick: concurrent calls collapse into one request.
   */
  async refresh(lng: number, lat: number, unit: SpeedUnit): Promise<void> {
    if (this.inFlight) return;
    if (this.lastFetch) {
      const moved = haversineMeters(this.lastFetch, [lng, lat]);
      if (moved < this.refetchDistanceM) return;
    }

    this.inFlight = true;
    this.lastFetch = [lng, lat];
    try {
      const fetched = await this.fetchSigns(bboxAround(lng, lat, this.spanDeg), unit);
      if (fetched.length > 0) {
        this.signs = [...this.signs, ...fetched].slice(-this.maxSigns);
      }
    } finally {
      this.inFlight = false;
    }
  }

  reset(): void {
    this.signs = [];
    this.lastFetch = null;
    this.inFlight = false;
  }
}
