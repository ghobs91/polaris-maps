/**
 * Transitous MOTIS 2 API client.
 *
 * Thin wrapper around fetch() for the MOTIS 2 REST API.
 * No external client library needed — just typed request/response shapes.
 *
 * Endpoint: https://api.transitous.org/api (configurable via env var)
 * Docs: https://redocly.github.io/redoc/?url=https://raw.githubusercontent.com/motis-project/motis/refs/tags/v2.8.3/openapi.yaml
 */

import { TRANSITOUS_BASE_URL } from '../../constants/config';
import type { TransitMode } from '../../models/transit';

// ── Config ────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 20_000;
const PLAN_API = '/api/v5/plan';

function getBaseUrl(): string {
  const url = TRANSITOUS_BASE_URL;
  if (!url) return 'https://api.transitous.org/api';
  return url;
}

async function motisFetch<T>(
  path: string,
  params: Record<string, string>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const url = new URL(path, getBaseUrl());
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') url.searchParams.set(k, v);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url.toString(), {
      signal: controller.signal,
      headers: {
        'User-Agent': 'PolarisMaps/1.0 (mailto:maps@polaris.app)',
        Accept: 'application/json',
      },
    });
    if (!res.ok) throw new Error(`MOTIS ${res.status}: ${await res.text().catch(() => '')}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

// ── API Types ─────────────────────────────────────────────────────────

export interface MotisPlace {
  name: string;
  stopId?: string;
  lat: number;
  lon: number;
  level?: number;
}

export interface MotisRoute {
  shortName?: string;
  longName?: string;
  color?: string;
  textColor?: string;
  type?: string; // "subway", "train", "tram", etc.
  agencyName?: string;
  agencyUrl?: string;
  gtfsId?: string;
}

export interface MotisIntermediateStop {
  name: string;
  stopId?: string;
  lat: number;
  lon: number;
  arrival?: string;
  departure?: string;
}

export interface MotisLeg {
  mode: string; // "walk", "transit", "bike", "car"
  from: MotisPlace;
  to: MotisPlace;
  startTime: string;
  endTime: string;
  duration: number; // seconds
  distance?: number; // meters
  transit?: {
    headSign?: string;
    route?: MotisRoute;
    tripId?: string;
    intermediateStops?: MotisIntermediateStop[];
  };
  geometry?: string; // encoded polyline
  interlineWithPreviousLeg?: boolean;
  realTime?: boolean;
  rental?: {
    providerName?: string;
    vehicleName?: string;
  };
}

export interface MotisItinerary {
  startTime: string;
  endTime: string;
  duration: number; // seconds
  walkDistance?: number;
  transfers: number;
  waitingTime?: number;
  legs: MotisLeg[];
  accessibilityScore?: number;
}

export interface MotisPlanResponse {
  from: MotisPlace;
  to: MotisPlace;
  itineraries: MotisItinerary[];
  direct: MotisItinerary[];
  nextPageCursor?: string;
  previousPageCursor?: string;
}

// ── Public API ────────────────────────────────────────────────────────

/**
 * Plan a transit journey via Transitous MOTIS 2 API.
 * Returns itineraries mapped from the MOTIS response.
 */
export async function planMotisTrip(params: {
  fromPlace: string; // "lat,lon" or stop ID
  toPlace: string;
  time?: string; // ISO date-time string
  arriveBy?: boolean;
  numItineraries?: number;
  maxTransfers?: number;
  maxTravelTime?: number; // minutes
  transitModes?: string;
  timeoutMs?: number;
}): Promise<MotisPlanResponse | null> {
  const qs: Record<string, string> = {
    fromPlace: params.fromPlace,
    toPlace: params.toPlace,
  };

  if (params.time) qs.time = params.time;
  if (params.arriveBy !== undefined) qs.arriveBy = String(params.arriveBy);
  if (params.numItineraries !== undefined) qs.numItineraries = String(params.numItineraries);
  if (params.maxTransfers !== undefined) qs.maxTransfers = String(params.maxTransfers);
  if (params.maxTravelTime !== undefined) qs.maxTravelTime = String(params.maxTravelTime);
  if (params.transitModes) qs.transitModes = params.transitModes;

  try {
    return await motisFetch<MotisPlanResponse>(PLAN_API, qs, params.timeoutMs);
  } catch (e) {
    console.warn('[transitous] planMotisTrip failed:', e);
    return null;
  }
}

// ── Mode Mapping ──────────────────────────────────────────────────────

const MOTIS_MODE_TO_LEG: Record<string, string> = {
  walk: 'WALK',
  bike: 'BICYCLE',
  car: 'CAR',
  transit: 'TRANSIT',
  car_park: 'CAR',
};

const MOTIS_ROUTE_TYPE_TO_TRANSIT: Record<string, TransitMode> = {
  subway: 'SUBWAY',
  metro: 'SUBWAY',
  suburban: 'RAIL',
  train: 'RAIL',
  rail: 'RAIL',
  tram: 'TRAM',
  light_rail: 'TRAM',
  bus: 'RAIL',
  coach: 'RAIL',
  ferry: 'FERRY',
  cable_car: 'CABLE_CAR',
  gondola: 'GONDOLA',
  funicular: 'FUNICULAR',
  monorail: 'RAIL',
};

export function motisLegMode(mode: string): string {
  return MOTIS_MODE_TO_LEG[mode] ?? mode.toUpperCase();
}

export function motisRouteTypeToTransit(routeType?: string): TransitMode {
  if (!routeType) return 'RAIL';
  return MOTIS_ROUTE_TYPE_TO_TRANSIT[routeType.toLowerCase()] ?? 'RAIL';
}
