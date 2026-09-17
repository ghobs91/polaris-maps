/**
 * Concrete media providers layered on top of `placeMediaService`.
 *
 * Both providers are supplements to the primary website scraper and are
 * best-effort: a failed or empty provider contributes nothing. `fetch` is
 * injectable so the network can be stubbed in tests.
 */

import { commonsThumbUrl } from './poiEnricher';
import {
  WIKIMEDIA_ATTRIBUTION,
  normalizePanoramaxResponse,
  type PlaceMediaItem,
  type PlaceMediaProvider,
} from './placeMediaService';

type FetchLike = typeof fetch;

const WIKIDATA_ENDPOINT = 'https://www.wikidata.org/w/api.php';
/** Panoramax STAC search endpoint (GeoJSON FeatureCollection). */
const PANORAMAX_SEARCH_ENDPOINT = 'https://api.panoramax.xyz/api/search';
const PANORAMAX_HALF_BOX_DEG = 0.005;
const REQUEST_TIMEOUT_MS = 6000;

interface WikidataClaim {
  mainsnak?: { datavalue?: { value?: unknown } };
}

function timeoutSignal(ms: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

async function requestJson(fetchImpl: FetchLike, url: string): Promise<unknown | null> {
  const { signal, cancel } = timeoutSignal(REQUEST_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { signal });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  } finally {
    cancel();
  }
}

/** Build a stable Wikimedia Commons file-description page URL. */
export function commonsFilePageUrl(filename: string): string {
  return `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(filename.replace(/ /g, '_'))}`;
}

function extractFilenames(claims: Record<string, WikidataClaim[]>, property: string): string[] {
  const list = claims[property];
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const claim of list) {
    const value = claim?.mainsnak?.datavalue?.value;
    if (typeof value === 'string' && value.length > 0) out.push(value);
  }
  return out;
}

function resolveQid(tags: Record<string, string>): string | null {
  const qid = tags['brand:wikidata'] ?? tags['operator:wikidata'] ?? tags['wikidata'];
  return qid && /^Q\d+$/.test(qid) ? qid : null;
}

/**
 * Wikimedia Commons photos (P18) and logos (P154) for a place's Wikidata
 * entity. License/attribution links point at the Commons file page.
 */
export function createWikidataCommonsProvider(fetchImpl: FetchLike = fetch): PlaceMediaProvider {
  return {
    id: 'wikimedia',
    async fetch(query) {
      const qid = resolveQid(query.tags);
      if (!qid) return [];

      const url =
        `${WIKIDATA_ENDPOINT}?action=wbgetentities&ids=${encodeURIComponent(qid)}` +
        `&props=claims&format=json&origin=*`;
      const data = (await requestJson(fetchImpl, url)) as {
        entities?: Record<string, { claims?: Record<string, WikidataClaim[]> }>;
      } | null;
      const claims = data?.entities?.[qid]?.claims;
      if (!claims) return [];

      const filenames = [...extractFilenames(claims, 'P18'), ...extractFilenames(claims, 'P154')];
      const seen = new Set<string>();
      const items: PlaceMediaItem[] = [];
      for (const filename of filenames) {
        if (!filename || seen.has(filename)) continue;
        seen.add(filename);
        items.push({
          url: commonsThumbUrl(filename, 1024),
          thumbnailUrl: commonsThumbUrl(filename, 320),
          source: 'wikimedia',
          license: 'See Commons file page',
          licenseUrl: commonsFilePageUrl(filename),
          attribution: WIKIMEDIA_ATTRIBUTION,
        });
      }
      return items;
    },
  };
}

/** Nearby Panoramax street-level imagery (CC-BY-SA) around the place. */
export function createPanoramaxProvider(fetchImpl: FetchLike = fetch): PlaceMediaProvider {
  return {
    id: 'panoramax',
    async fetch(query) {
      const d = PANORAMAX_HALF_BOX_DEG;
      const bbox = [query.lng - d, query.lat - d, query.lng + d, query.lat + d].join(',');
      const url = `${PANORAMAX_SEARCH_ENDPOINT}?bbox=${bbox}&limit=6`;
      const data = await requestJson(fetchImpl, url);
      if (!data) return [];
      return normalizePanoramaxResponse(data);
    },
  };
}

/**
 * Default supplementary providers, tried in order after the website scraper.
 *
 * Panoramax is intentionally NOT included: its assets are equirectangular
 * 360° street-level panoramas, which look like a distorted skyline when shown
 * as a place photo. The provider is kept for a future dedicated street-level
 * surface, but is not mixed into the place photo carousel.
 */
export function defaultPlaceMediaSupplements(fetchImpl: FetchLike = fetch): PlaceMediaProvider[] {
  return [createWikidataCommonsProvider(fetchImpl)];
}
