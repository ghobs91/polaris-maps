import { fetchOsmPois, type OsmPoi } from '../poi/osmFetcher';
import { haversineMeters } from '../../utils/routeSnap';
import type { SavedPlace } from '../../models/placeList';

/**
 * Best-effort enrichment for saved places, resolved from OpenStreetMap.
 *
 * Saved places carry neither opening hours nor (often) a website, and Apple
 * MapKit exposes no hours — so both are filled from OSM. To keep this cheap for
 * long lists, one Overpass query is issued for the bounding box covering every
 * place in the list (never one query per place), then each place is matched to
 * a nearby named POI. Results are cached in memory.
 */

export interface PlaceEnrichment {
  openingHours?: string;
  website?: string;
}

const MATCH_RADIUS_M = 120;
/** Skip the lookup when a list spans more than this (avoids a global query). */
const MAX_BBOX_SPAN_DEG = 0.5;

const enrichmentCache = new Map<string, PlaceEnrichment | null>();

function cacheKey(place: SavedPlace): string {
  return `${place.id}:${place.lat.toFixed(4)},${place.lng.toFixed(4)}`;
}

function normalizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function namesMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function pickEnrichment(place: SavedPlace, pois: OsmPoi[]): PlaceEnrichment | null {
  const target = normalizeName(place.name);
  let best: { distance: number; enrichment: PlaceEnrichment } | null = null;

  for (const poi of pois) {
    const distance = haversineMeters([place.lng, place.lat], [poi.lng, poi.lat]);
    if (distance > MATCH_RADIUS_M) continue;
    if (!namesMatch(target, normalizeName(poi.name))) continue;

    const enrichment: PlaceEnrichment = {
      openingHours: poi.tags['opening_hours'] ?? poi.tags['hours'],
      website: poi.tags['website'] ?? poi.tags['contact:website'] ?? poi.tags['url'],
    };
    if (!enrichment.openingHours && !enrichment.website) continue;
    if (!best || distance < best.distance) best = { distance, enrichment };
  }

  return best?.enrichment ?? null;
}

/**
 * Resolve OSM enrichment for the given places.
 * Returns a map of place id → enrichment. Places with nothing useful are absent.
 */
export async function loadPlaceEnrichmentForPlaces(
  places: SavedPlace[],
): Promise<Record<string, PlaceEnrichment>> {
  const result: Record<string, PlaceEnrichment> = {};
  const pending: SavedPlace[] = [];

  for (const place of places) {
    if (place.lat === 0 && place.lng === 0) continue;
    const key = cacheKey(place);
    const cached = enrichmentCache.get(key);
    if (cached !== undefined) {
      if (cached) result[place.id] = cached;
      continue;
    }
    pending.push(place);
  }
  if (pending.length === 0) return result;

  const lats = pending.map((p) => p.lat);
  const lngs = pending.map((p) => p.lng);
  const south = Math.min(...lats);
  const north = Math.max(...lats);
  const west = Math.min(...lngs);
  const east = Math.max(...lngs);
  if (north - south > MAX_BBOX_SPAN_DEG || east - west > MAX_BBOX_SPAN_DEG) {
    return result;
  }

  let pois: OsmPoi[] = [];
  try {
    pois = await fetchOsmPois(south, west, north, east);
  } catch {
    pois = [];
  }

  for (const place of pending) {
    const enrichment = pois.length ? pickEnrichment(place, pois) : null;
    enrichmentCache.set(cacheKey(place), enrichment);
    if (enrichment) result[place.id] = enrichment;
  }
  return result;
}

/** Clear the in-memory enrichment cache (used by tests). */
export function clearPlaceEnrichmentCache(): void {
  enrichmentCache.clear();
}
