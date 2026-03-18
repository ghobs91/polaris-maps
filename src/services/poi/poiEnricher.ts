import type { OsmPoi } from './osmFetcher';
import { searchPOI } from '../../native/mapkit';
import type { NativeMapKitPoi } from '../../native/mapkit';

/**
 * Supplementary data sourced from Apple MapKit (native iOS SDK).
 *
 * The native MKLocalSearch / MKMapItem API provides rich POI data that the
 * Apple Maps Server API does not: phone numbers, website URLs, timezone, and
 * detailed address components.
 */
export interface EnrichedPoiData {
  /** Phone number, e.g. "+1 (408) 555-1234" */
  phone?: string;
  /** Website URL string */
  website?: string;
  /** Formatted multi-line address */
  formattedAddress?: string;
  /** Apple Maps category label, e.g. "MKPOICategory.cafe" */
  poiCategory?: string;
  /** IANA timezone identifier, e.g. "America/Los_Angeles" */
  timeZone?: string;
  /** Brand logo image URL from Wikimedia Commons (via Wikidata P154/P18) */
  logoUrl?: string;
  /** Human-readable opening hours string from MapKit (iOS 16+) */
  openingHours?: string;
  /** Raw native MapKit result for future extensions */
  nativeMapKitPoi?: NativeMapKitPoi;
}

// In-memory LRU-style cache keyed by OSM POI id.
const enrichmentCache = new Map<number, EnrichedPoiData | null>();
const MAX_CACHE_SIZE = 500;

function cacheSet(key: number, value: EnrichedPoiData | null) {
  // Evict oldest when full
  if (enrichmentCache.size >= MAX_CACHE_SIZE) {
    const first = enrichmentCache.keys().next().value;
    if (first !== undefined) enrichmentCache.delete(first);
  }
  enrichmentCache.set(key, value);
}

/**
 * Enrich an OSM POI with data from Apple Maps.
 *
 * Only fields that are **missing** from the OSM tags are filled in from Apple
 * Maps — OSM data is always treated as the primary source of truth.
 *
 * Results are cached to avoid redundant API calls when the user re-selects
 * the same POI.
 */
export async function enrichPoi(poi: OsmPoi): Promise<EnrichedPoiData> {
  // Check cache first
  if (enrichmentCache.has(poi.id)) {
    return enrichmentCache.get(poi.id) ?? {};
  }

  const match = await searchPOI(poi.name, poi.lat, poi.lng);

  // Start logo fetch in parallel with the rest of the enrichment
  const logoPromise = fetchWikidataLogo(poi.tags).catch(() => undefined);

  if (!match) {
    const logoUrl = await logoPromise;
    const partial: EnrichedPoiData = logoUrl ? { logoUrl } : {};
    cacheSet(poi.id, partial);
    return partial;
  }

  const t = poi.tags;

  const enriched: EnrichedPoiData = { nativeMapKitPoi: match };

  // Phone number — only if OSM doesn't already have one
  if (!t['phone'] && !t['contact:phone'] && match.phoneNumber) {
    enriched.phone = match.phoneNumber;
  }

  // Website — only if OSM doesn't already have one
  const websiteUrl = match.url;
  if (!t['website'] && !t['contact:website'] && websiteUrl) {
    enriched.website = websiteUrl;
  }

  // Formatted address — only fill if OSM has no address tags
  if (!t['addr:street'] && match.formattedAddress) {
    enriched.formattedAddress = match.formattedAddress.replace(/\n/g, ', ');
  }

  // Apple Maps category
  if (match.pointOfInterestCategory) {
    enriched.poiCategory = match.pointOfInterestCategory;
  }

  // Timezone
  if (match.timeZone) {
    enriched.timeZone = match.timeZone;
  }

  // Brand logo from Wikidata
  const logoUrl = await logoPromise;
  if (logoUrl) {
    enriched.logoUrl = logoUrl;
  }

  // Opening hours from MapKit (iOS 16+) — only if OSM tags are empty
  if (!t['opening_hours'] && match.openingHoursPeriods?.length) {
    enriched.openingHours = formatOpeningHours(match.openingHoursPeriods);
  }

  cacheSet(poi.id, enriched);
  return enriched;
}

// ---------------------------------------------------------------------------
// Wikidata logo helpers
// ---------------------------------------------------------------------------

/** Cache QID → logo URL to avoid redundant API calls for the same brand */
const wikidataLogoCache = new Map<string, string | null>();

/**
 * Attempt to fetch a brand logo from Wikimedia Commons via Wikidata.
 *
 * Resolution order for finding a Wikidata QID:
 *  1. `brand:wikidata` OSM tag (most common for chains)
 *  2. `operator:wikidata` OSM tag
 *  3. `wikidata` OSM tag (the entity itself)
 *
 * Once a QID is found, we fetch property P154 (logo image) or P18 (image)
 * and construct a Wikimedia Commons thumbnail URL.
 */
export async function fetchWikidataLogo(tags: Record<string, string>): Promise<string | undefined> {
  const qid = tags['brand:wikidata'] ?? tags['operator:wikidata'] ?? tags['wikidata'];
  if (!qid || !/^Q\d+$/.test(qid)) return undefined;

  // Check in-memory cache
  if (wikidataLogoCache.has(qid)) {
    return wikidataLogoCache.get(qid) ?? undefined;
  }

  const filename = await fetchLogoFilename(qid);
  if (!filename) {
    wikidataLogoCache.set(qid, null);
    return undefined;
  }

  const url = commonsThumbUrl(filename, 256);
  wikidataLogoCache.set(qid, url);
  return url;
}

/**
 * Fetch the logo filename from Wikidata for a given QID.
 * Uses wbgetentities to retrieve P154 (logo) and P18 (image) in one request,
 * preferring P154 when both exist.
 */
async function fetchLogoFilename(qid: string): Promise<string | undefined> {
  const url =
    `https://www.wikidata.org/w/api.php` +
    `?action=wbgetentities&ids=${encodeURIComponent(qid)}` +
    `&props=claims&format=json&origin=*`;

  // Use AbortController + setTimeout for Hermes compatibility
  // (AbortSignal.timeout is not available in all RN engines)
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return undefined;

    const data: WikidataEntitiesResponse = await res.json();
    const claims = data.entities?.[qid]?.claims;
    if (!claims) return undefined;

    // Prefer P154 (logo image), fall back to P18 (general image)
    return extractFilenameFromClaims(claims, 'P154') ?? extractFilenameFromClaims(claims, 'P18');
  } finally {
    clearTimeout(timer);
  }
}

interface WikidataClaim {
  mainsnak?: {
    datavalue?: {
      value?: string;
      type?: string;
    };
  };
}

interface WikidataEntitiesResponse {
  entities?: Record<
    string,
    {
      claims?: Record<string, WikidataClaim[]>;
    }
  >;
}

function extractFilenameFromClaims(
  claims: Record<string, WikidataClaim[]>,
  property: string,
): string | undefined {
  const propClaims = claims[property];
  if (!propClaims?.length) return undefined;
  const value = propClaims[0]?.mainsnak?.datavalue?.value;
  return typeof value === 'string' ? value : undefined;
}

/**
 * Build a Wikimedia Commons thumbnail URL from a file title.
 * Uses the Special:FilePath redirect which handles all hashing internally.
 */
export function commonsThumbUrl(filename: string, width: number): string {
  const encoded = encodeURIComponent(filename.replace(/ /g, '_'));
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encoded}?width=${width}`;
}

// ---------------------------------------------------------------------------
// Opening hours formatting
// ---------------------------------------------------------------------------

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Convert MapKit opening-hours periods into a human-readable string.
 */
export function formatOpeningHours(
  periods: Array<{ openDay?: string; openTime?: string; closeDay?: string; closeTime?: string }>,
): string {
  return periods
    .map((p) => {
      const day = p.openDay != null ? (DAY_NAMES[parseInt(p.openDay, 10) - 1] ?? '') : '';
      const open = p.openTime ?? '';
      const close = p.closeTime ?? '';
      if (!open) return null;
      return close ? `${day} ${open}–${close}`.trim() : `${day} ${open}+`.trim();
    })
    .filter(Boolean)
    .join(', ');
}

/**
 * Clear the enrichment cache (useful for tests).
 */
export function clearEnrichmentCache() {
  enrichmentCache.clear();
  wikidataLogoCache.clear();
}
