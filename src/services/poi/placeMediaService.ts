/**
 * Place media sourcing.
 *
 * The retained on-device website scraper (`websitePhotosService`) is the
 * PRIMARY source. Openly-licensed providers (Wikimedia Commons, Panoramax) are
 * layered on as SUPPLEMENTS, each carrying license + attribution metadata.
 */

export type PlaceMediaSource = 'website' | 'wikimedia' | 'panoramax';

export interface PlaceMediaItem {
  url: string;
  source: PlaceMediaSource;
  thumbnailUrl?: string;
  license?: string;
  licenseUrl?: string;
  author?: string;
  /** Display attribution for open-source media. */
  attribution?: string;
}

export interface PlaceMediaQuery {
  lat: number;
  lng: number;
  name?: string;
  tags: Record<string, string>;
}

export interface PlaceMediaProvider {
  id: PlaceMediaSource;
  fetch(query: PlaceMediaQuery): Promise<PlaceMediaItem[]>;
}

export const WIKIMEDIA_ATTRIBUTION = 'Wikimedia Commons';
export const PANORAMAX_ATTRIBUTION = 'Panoramax (CC-BY-SA)';

/** Merge primary (website) and supplementary media, deduped by URL, website first. */
export function mergePlaceMedia(
  primary: readonly PlaceMediaItem[],
  supplements: readonly PlaceMediaItem[],
): PlaceMediaItem[] {
  const seen = new Set<string>();
  const out: PlaceMediaItem[] = [];
  for (const item of [...primary, ...supplements]) {
    if (!item.url || seen.has(item.url)) continue;
    seen.add(item.url);
    out.push(item);
  }
  return out;
}

function stripHtml(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const text = value.replace(/<[^>]*>/g, '').trim();
  return text.length > 0 ? text : undefined;
}

interface WikimediaExtMetadata {
  LicenseShortName?: { value?: string };
  Artist?: { value?: string };
}

/** Normalize a Wikimedia Commons `query`+`imageinfo` response. */
export function normalizeWikimediaResponse(payload: unknown): PlaceMediaItem[] {
  const pages = (payload as { query?: { pages?: Record<string, unknown> } })?.query?.pages;
  if (!pages || typeof pages !== 'object') return [];

  const items: PlaceMediaItem[] = [];
  for (const page of Object.values(pages)) {
    const infos = (page as { imageinfo?: unknown[] })?.imageinfo;
    const info = Array.isArray(infos) ? (infos[0] as Record<string, unknown>) : undefined;
    if (!info) continue;
    const url = (info.thumburl as string) ?? (info.url as string);
    if (!url) continue;
    const meta = (info.extmetadata ?? {}) as WikimediaExtMetadata;
    items.push({
      url,
      thumbnailUrl: (info.thumburl as string) ?? undefined,
      source: 'wikimedia',
      license: meta.LicenseShortName?.value,
      licenseUrl: info.descriptionurl as string | undefined,
      author: stripHtml(meta.Artist?.value),
      attribution: WIKIMEDIA_ATTRIBUTION,
    });
  }
  return items;
}

/** Normalize a Panoramax STAC feature collection. */
export function normalizePanoramaxResponse(payload: unknown): PlaceMediaItem[] {
  const features = (payload as { features?: unknown[] })?.features;
  if (!Array.isArray(features)) return [];

  const items: PlaceMediaItem[] = [];
  for (const feature of features) {
    const f = feature as {
      assets?: Record<string, { href?: string }>;
      properties?: Record<string, unknown>;
    };
    const url = f.assets?.hd?.href ?? f.assets?.sd?.href;
    if (!url) continue;
    items.push({
      url,
      thumbnailUrl: f.assets?.thumb?.href,
      source: 'panoramax',
      license: (f.properties?.license as string) ?? undefined,
      author: (f.properties?.author as string) ?? undefined,
      attribution: PANORAMAX_ATTRIBUTION,
    });
  }
  return items;
}

/**
 * Collect place media: website scraping primary, open providers as supplements.
 * Every provider is best-effort — a failed provider contributes nothing.
 */
export async function collectPlaceMedia(
  query: PlaceMediaQuery,
  opts: {
    websiteProvider?: PlaceMediaProvider;
    supplements?: readonly PlaceMediaProvider[];
  } = {},
): Promise<PlaceMediaItem[]> {
  const primary = opts.websiteProvider
    ? await opts.websiteProvider.fetch(query).catch(() => [])
    : [];

  const supplementResults = await Promise.all(
    (opts.supplements ?? []).map((provider) => provider.fetch(query).catch(() => [])),
  );

  return mergePlaceMedia(primary, supplementResults.flat());
}
