/**
 * TripAdvisor provider for on-device aggregate ratings.
 *
 * TripAdvisor listing pages reliably expose JSON-LD `aggregateRating`, so the
 * plain-fetch path is primary and the hidden WebView is the fallback. Only the
 * `tripadvisor.com` / `www.tripadvisor.com` hosts are ever loaded, direct listing
 * references only — no search-engine scraping, no CAPTCHA solving, no stealth.
 */

import {
  buildCollectorScript,
  discoverListingFromAnchors,
  extractLdBlocks,
  findAggregateRating,
  parseExactCount,
  parseRatingFromStarText,
  parseRatingMessageFromWebView,
  parseSearchMessageFromWebView,
  pageIsChallenge,
} from './core';
import type { ExternalRatingProvider } from './provider';
import type { RawExternalRating, RatingSearchCandidate } from './types';

// ---------------------------------------------------------------------------
// Host allowlist + URL validation
// ---------------------------------------------------------------------------

/**
 * Exact host allowlist. Deliberately narrow: only the primary .com host and its
 * www subdomain. Country variants require separate allowlisting and are
 * intentionally excluded until reviewed.
 */
export const TRIPADVISOR_ALLOWED_HOSTS = ['tripadvisor.com', 'www.tripadvisor.com'] as const;

export function isAllowedTripadvisorHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return (TRIPADVISOR_ALLOWED_HOSTS as readonly string[]).includes(host);
}

/** True for a tripadvisor.com http(s) URL. Never load anything else. */
export function isTripadvisorUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return (
      (u.protocol === 'https:' || u.protocol === 'http:') && isAllowedTripadvisorHost(u.hostname)
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Listing URL canonicalization
// ---------------------------------------------------------------------------

export interface TripadvisorListingInfo {
  url: string;
  placeId: string | null;
  listingType: string | null;
}

const TRIPADVISOR_LISTING_TYPES = [
  'Attraction',
  'Cruise',
  'CruiseShippingTerminal',
  'Flight',
  'GolfCourse',
  'HealthSpa',
  'Hotel',
  'Nightlife',
  'Restaurant',
  'Shopping',
  'Spa',
  'Tour',
  'ThingsToDo',
  'VacationRental',
];

/**
 * Parse a TripAdvisor listing URL into its structured pieces. Returns null when
 * the URL is not an allowed host or is not a listing.
 */
export function parseTripadvisorListingUrl(url: string): TripadvisorListingInfo | null {
  if (!isTripadvisorUrl(url)) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const pathname = parsed.pathname;

  let listingType: string | null = null;
  for (const type of TRIPADVISOR_LISTING_TYPES) {
    const re = new RegExp(`(?:^|/)${type}(?:_Review|_[0-9]{3,})`, 'i');
    if (re.test(pathname)) {
      listingType = type;
      break;
    }
  }
  if (!listingType) return null;

  const idMatch = /(?:^|[-/])d([0-9]{3,})(?:[-/]|$)/.exec(pathname);
  const placeId = idMatch ? idMatch[1] : null;

  return { url: parsed.toString(), placeId: placeId ?? null, listingType };
}

/** Canonical listing URL for a TripAdvisor URL, or null when not a listing. */
export function canonicalTripadvisorListingUrl(url: string): string | null {
  return parseTripadvisorListingUrl(url)?.url ?? null;
}

/**
 * Resolve a TripAdvisor listing URL from a POI: explicit `polaris:tripadvisor`
 * tag first, then a caller-supplied override.
 */
export function resolveTripadvisorUrl(
  poi: { name: string; tags?: Record<string, string>; website?: string | null },
  options?: { overrideUrl?: string | null },
): string | null {
  const explicit = options?.overrideUrl ?? poi.tags?.['polaris:tripadvisor'];
  if (explicit && isTripadvisorUrl(explicit)) {
    return parseTripadvisorListingUrl(explicit)?.url ?? null;
  }
  return null;
}

/** Discover a TripAdvisor listing URL from a POI website's HTML anchors. */
export function discoverTripadvisorFromWebsiteHtml(html: string, baseUrl: string): string | null {
  return discoverListingFromAnchors(
    html,
    baseUrl,
    isTripadvisorUrl,
    canonicalTripadvisorListingUrl,
  );
}

// ---------------------------------------------------------------------------
// Fetch-path rating extraction
// ---------------------------------------------------------------------------

/** Collect `data-automation` review/rating/count element text. */
export function collectAutomationText(html: string): string[] {
  const out: string[] = [];
  const re = /<[^>]+data-automation=["'][^"']+["'][^>]*>([\s\S]*?)<\/[^>]+>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const tag = m[0];
    const automation = /\bdata-automation=["']([^"']+["'])/i.exec(tag);
    const value = (automation?.[1] ?? '').replace(/["']/g, '');
    const lower = value.toLowerCase();
    if (!/(review|rating|count)/.test(lower)) continue;
    const body = m[1] ?? '';
    const text = body
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) out.push(text);
  }
  return out;
}

/**
 * Extract a raw external rating from a TripAdvisor listing page's HTML.
 * Prefers JSON-LD `aggregateRating`; falls back to `data-automation` text.
 */
export function parseExternalRatingFromHtml(html: string): RawExternalRating | null {
  const ld = findAggregateRating(extractLdBlocks(html));

  const automation = collectAutomationText(html);
  let automationRating: number | null = null;
  let automationCount: number | null = null;
  for (const text of automation) {
    if (automationRating == null) automationRating = parseRatingFromStarText(text);
    if (automationCount == null) automationCount = parseExactCount(text);
  }

  const rating = ld.rating ?? automationRating;
  const count = ld.count ?? automationCount;
  const listingName = ld.name ?? null;

  const extracted = rating != null && count != null;
  // Markers alone are not a verdict: valid pages can carry DataDome scripts.
  if (pageIsChallenge(html, extracted)) return null;

  if (rating == null || count == null) return null;

  return {
    rating,
    reviewCount: count,
    listingName,
    listingAddress: ld.address ?? null,
    geo: ld.geo,
    challenge: false,
  };
}

// ---------------------------------------------------------------------------
// Injected JS for the hidden-WebView stages
// ---------------------------------------------------------------------------

/**
 * Listing-stage injected JS. Re-collects until JSON-LD `aggregateRating` or
 * `data-automation` text is available (or attempts run out), so a page briefly
 * presenting an anti-bot interstitial is re-read once it clears. No separate
 * challenge latch in-page: markers without data are not a verdict (verified
 * against live pages that embed DataDome scripts with full content).
 */
export const TRIPADVISOR_RATING_JS = buildCollectorScript({
  providerId: 'tripadvisor',
  payloadType: 'external-rating',
  hasDataJs: 'out.ldRating != null && out.ldCount != null',
  initialDelayMs: 1000,
  retryIntervalMs: 2000,
  maxAttempts: 5,
  collectBodyJs: `    out.ldRating = null;
    out.ldCount = null;
    out.ldName = null;
    out.ldAddress = null;
    out.geo = null;
    out.automation = [];
    var scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (var i = 0; i < scripts.length; i++) {
      try {
        var data = JSON.parse(scripts[i].textContent || 'null');
        var items = Array.isArray(data) ? data : [data];
        for (var k = 0; k < items.length; k++) {
          var it = items[k];
          if (!it || typeof it !== 'object') continue;
          var ar = it.aggregateRating;
          var arr = Array.isArray(ar) ? ar : (ar ? [ar] : []);
          for (var a = 0; a < arr.length; a++) {
            if (out.ldRating == null && arr[a].ratingValue != null) out.ldRating = Number(arr[a].ratingValue);
            if (out.ldCount == null && arr[a].reviewCount != null) out.ldCount = Number(arr[a].reviewCount);
          }
          if (out.ldName == null && it.name) out.ldName = String(it.name);
          if (!out.ldAddress && it.address) {
            out.ldAddress = typeof it.address === 'string' ? it.address : (it.address.streetAddress || null);
          }
          if (!out.geo && it.geo && it.geo.latitude != null && it.geo.longitude != null) {
            out.geo = { lat: Number(it.geo.latitude), lng: Number(it.geo.longitude) };
          }
          if (out.ldRating != null && out.ldCount != null) break;
        }
      } catch (e) { /* malformed JSON-LD — ignore */ }
    }
    if (out.ldRating == null || out.ldCount == null) {
      var autos = document.querySelectorAll('[data-automation]');
      for (var j = 0; j < autos.length; j++) {
        var dv = autos[j].getAttribute('data-automation') || '';
        var lower = dv.toLowerCase();
        if (lower.indexOf('review') !== -1 || lower.indexOf('rating') !== -1 || lower.indexOf('count') !== -1) {
          var txt = (autos[j].textContent || '').replace(/\\s+/g, ' ').trim();
          if (txt) out.automation.push(txt);
        }
      }
    }`,
});

/**
 * Search-stage injected JS. Re-collects until `_Review-` listing anchors appear
 * (or attempts run out). No separate challenge latch: markers without data are
 * not a verdict.
 */
export const TRIPADVISOR_SEARCH_JS = buildCollectorScript({
  providerId: 'tripadvisor',
  payloadType: 'rating-search',
  hasDataJs: 'out.candidates.length > 0',
  initialDelayMs: 1500,
  retryIntervalMs: 2500,
  maxAttempts: 5,
  collectBodyJs: `    out.candidates = [];
    var seen = {};
    var anchors = document.querySelectorAll('a[href]');
    for (var i = 0; i < anchors.length && out.candidates.length < 20; i++) {
      var href = anchors[i].getAttribute('href') || '';
      if (href.indexOf('_Review-') === -1 && !/[A-Za-z]+_[0-9]{3,}/.test(href)) continue;
      var abs;
      try { abs = new URL(href, location.href).toString(); } catch (e) { continue; }
      if (seen[abs]) continue;
      seen[abs] = true;
      var name = (anchors[i].textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120);
      out.candidates.push({ url: abs, name: name || null, address: null, geo: null });
    }`,
});

/** Parse a listing-stage WebView payload for TripAdvisor. */
export function extractRatingFromWebViewMessage(data: string): RawExternalRating | null {
  return parseRatingMessageFromWebView(data, 'tripadvisor');
}

/** Parse a search-stage WebView payload for TripAdvisor. */
export function extractSearchFromWebViewMessage(data: string): RatingSearchCandidate[] | null {
  return parseSearchMessageFromWebView(data, 'tripadvisor');
}

/** Parse candidate listings from a TripAdvisor search results page. */
export function parseTripadvisorSearchResults(
  html: string,
  baseUrl: string,
): RatingSearchCandidate[] {
  const out: RatingSearchCandidate[] = [];
  const seen = new Set<string>();
  const anchorRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null && out.length < 20) {
    const href = (m[1] ?? '').trim();
    if (!href) continue;
    let abs: URL;
    try {
      abs = new URL(href, baseUrl);
    } catch {
      continue;
    }
    const canonical = canonicalTripadvisorListingUrl(abs.toString());
    if (!canonical || seen.has(canonical)) continue;
    seen.add(canonical);
    const name = (m[2] ?? '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
    out.push({ url: canonical, name: name || null, address: null, geo: null });
  }
  return out;
}

/** Build a TripAdvisor search URL for a place name + address. */
export function buildTripadvisorSearchUrl(name: string, address: string | null): string {
  const query = [name, address].filter(Boolean).join(' ');
  return `https://www.tripadvisor.com/Search?q=${encodeURIComponent(query)}`;
}

/** The TripAdvisor provider adapter. */
export const tripadvisorProvider: ExternalRatingProvider = {
  id: 'tripadvisor',
  allowedHosts: TRIPADVISOR_ALLOWED_HOSTS,
  isProviderUrl: isTripadvisorUrl,
  parseListingUrl: canonicalTripadvisorListingUrl,
  discoverFromWebsiteHtml: discoverTripadvisorFromWebsiteHtml,
  buildSearchUrl: buildTripadvisorSearchUrl,
  parseSearchResults: parseTripadvisorSearchResults,
  parseRatingFromHtml: parseExternalRatingFromHtml,
  listingJs: TRIPADVISOR_RATING_JS,
  searchJs: TRIPADVISOR_SEARCH_JS,
  parseRatingMessage: extractRatingFromWebViewMessage,
  parseSearchMessage: extractSearchFromWebViewMessage,
};
