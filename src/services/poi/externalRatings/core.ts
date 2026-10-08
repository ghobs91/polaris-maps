/**
 * Shared core for on-device external rating providers.
 *
 * Everything here is provider-agnostic: JSON-LD `aggregateRating` parsing,
 * anti-bot challenge detection, exact-count and star-text parsing, listing-name
 * matching, result validation, an abortable fetch helper, an in-memory TTL
 * cache, and the generic WebView message parsers used by every provider.
 *
 * Providers (TripAdvisor, Yelp) supply only their host allowlist, URL/HTML
 * parsing, and injected JS.
 */

import type {
  ExternalRatingProviderId,
  ExternalRatingSummary,
  GeoPoint,
  RawExternalRating,
  RatingSearchCandidate,
} from './types';

// ---------------------------------------------------------------------------
// Anti-bot challenge detection
// ---------------------------------------------------------------------------
//
// DataDome and friends inject script tags/frames into perfectly valid content
// pages too (verified against live Yelp pages: markers present AND a complete
// JSON-LD rating served). So a marker match alone is NOT a challenge verdict —
// it is only fatal when nothing extractable was found alongside it.

/** Challenge/anti-bot markers that indicate the page may not be a real listing. */
const CHALLENGE_MARKERS = [
  'datadome',
  'akamai',
  'perimeterx',
  'just a moment',
  'cf-challenge',
  'challenge-platform',
  'attention required',
  'verify you are human',
  'are you a robot',
];

/** True when the raw HTML carries anti-bot markers at all. */
export function hasChallengeMarkers(html: string): boolean {
  const lower = html.toLowerCase();
  return CHALLENGE_MARKERS.some((marker) => lower.includes(marker));
}

/**
 * A page counts as a challenge only when anti-bot markers are present and no
 * usable rating data was extracted from it. Markers without data (a real
 * protection script embedded in a valid page) are not a verdict.
 */
export function pageIsChallenge(html: string, extractedData: boolean): boolean {
  return hasChallengeMarkers(html) && !extractedData;
}

/** The same markers, as a JSON array literal, for injection into ES5 page JS. */
export const CHALLENGE_MARKERS_JSON = JSON.stringify(CHALLENGE_MARKERS);

// ---------------------------------------------------------------------------
// JSON-LD parsing
// ---------------------------------------------------------------------------

export function extractLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const text = (m[1] ?? '').trim();
    if (!text) continue;
    try {
      blocks.push(JSON.parse(text));
    } catch {
      /* malformed JSON-LD — ignore */
    }
  }
  return blocks;
}

/** Parse a rating value that may be a JSON number or numeric string. */
function parseLdRating(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? parseFloat(value) : NaN;
  if (!Number.isFinite(n)) return null;
  return n;
}

/** Parse an exact, non-negative integer count from JSON-LD. */
function parseLdCount(value: unknown): number | null {
  const n =
    typeof value === 'number' ? value : typeof value === 'string' ? parseInt(value, 10) : NaN;
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}

/** Normalize a JSON-LD address (string or Address object) to a single line. */
function normalizeLdAddress(address: unknown): string | null {
  if (!address) return null;
  if (typeof address === 'string') return address;
  if (typeof address === 'object') {
    const o = address as Record<string, unknown>;
    const parts = [
      o.streetAddress,
      o.addressLocality,
      o.addressRegion,
      o.postalCode,
      o.addressCountry,
    ];
    const joined = parts.filter((p): p is string => typeof p === 'string').join(', ');
    return joined || null;
  }
  return null;
}

/** Parse a JSON-LD `geo` (GeoCoordinates) into a point, when present. */
function parseLdGeo(value: unknown): GeoPoint | null {
  if (!value || typeof value !== 'object') return null;
  const g = value as Record<string, unknown>;
  const lat =
    typeof g.latitude === 'number'
      ? g.latitude
      : typeof g.latitude === 'string'
        ? parseFloat(g.latitude)
        : NaN;
  const lng =
    typeof g.longitude === 'number'
      ? g.longitude
      : typeof g.longitude === 'string'
        ? parseFloat(g.longitude)
        : NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

export interface LdRating {
  rating: number | null;
  count: number | null;
  name: string | null;
  address: string | null;
  geo: GeoPoint | null;
}

export function findAggregateRating(blocks: unknown[]): LdRating {
  const out: LdRating = { rating: null, count: null, name: null, address: null, geo: null };
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    const item = block as Record<string, unknown>;
    const items: unknown[] = Array.isArray(item) ? item : [item];
    for (const it of items) {
      if (!it || typeof it !== 'object') continue;
      const o = it as Record<string, unknown>;

      const ratingAr = o.aggregateRating;
      const ratings = Array.isArray(ratingAr) ? ratingAr : ratingAr ? [ratingAr] : [];
      for (const ar of ratings) {
        if (!ar || typeof ar !== 'object') continue;
        const a = ar as Record<string, unknown>;
        if (out.rating == null) out.rating = parseLdRating(a.ratingValue);
        if (out.count == null) out.count = parseLdCount(a.reviewCount);
      }

      if (out.rating == null && out.count == null) {
        const topRating = parseLdRating(o.ratingValue);
        const topCount = parseLdCount(o.reviewCount);
        if (topRating != null || topCount != null) {
          out.rating = topRating;
          out.count = topCount;
        }
      }
      if (out.name == null && typeof o.name === 'string') out.name = o.name;
      if (out.address == null) out.address = normalizeLdAddress(o.address);
      if (out.geo == null) out.geo = parseLdGeo(o.geo);

      if (out.rating != null && out.count != null) return out;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Text parsing helpers
// ---------------------------------------------------------------------------

/** Parse a "4.5 star rating" style string into a 0–5 number. */
export function parseRatingFromStarText(text: string): number | null {
  const m = /(\d+(?:\.\d+)?)\s*star/i.exec(text);
  if (!m) return null;
  const n = parseFloat(m[1] as string);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse an exact review count from text like "1,234 reviews".
 * Returns null for approximate counts ("over 1,000", "1.2K", "about 50").
 */
export function parseExactCount(text: string): number | null {
  const lower = text.toLowerCase();
  if (/\b(over|about|approx|more than|than|less than|roughly|nearly|somewhere)\b/.test(lower)) {
    return null;
  }
  if (/\d\s*[kKmM]\b/.test(text)) return null;
  const m = /(\d{1,3}(?:,\d{3})+|\d+)\s*reviews?\b/i.exec(text);
  if (!m) return null;
  const n = parseInt((m[1] as string).replace(/,/g, ''), 10);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

// ---------------------------------------------------------------------------
// Name matching
// ---------------------------------------------------------------------------

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Loose name match: exact, or one containing the other (min 4 chars). */
export function namesMatch(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 4 && (na.includes(nb) || nb.includes(na))) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate a raw extraction into a typed ExternalRatingSummary.
 *
 * Rejects when:
 *  - the page looks like a challenge/anti-bot page,
 *  - the rating is not a finite number in [0, 5],
 *  - the count is not an exact non-negative integer,
 *  - no listing name is present,
 *  - the listing name does not match the expected POI name (when provided).
 */
export function validateExternalRating(
  raw: RawExternalRating,
  listingUrl: string,
  provider: ExternalRatingProviderId,
  options?: { expectedName?: string | null },
): ExternalRatingSummary | null {
  if (raw.challenge) return null;
  const { rating, reviewCount, listingName, listingAddress } = raw;
  if (rating == null || reviewCount == null || !listingName) return null;
  if (!Number.isFinite(rating) || rating < 0 || rating > 5) return null;
  if (!Number.isInteger(reviewCount) || reviewCount < 0) return null;
  if (options?.expectedName && !namesMatch(listingName, options.expectedName)) return null;

  const summary: ExternalRatingSummary = {
    provider,
    listingUrl,
    listingName,
    rating,
    reviewCount,
    observedAt: Date.now(),
  };
  if (listingAddress) summary.listingAddress = listingAddress;
  return summary;
}

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

/** Fetch HTML with an abort timeout, capped at 500 KB of parse work. */
export async function fetchPageHtml(url: string, timeoutMs: number): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'text/html' },
    });
    if (!res.ok) return null;
    const contentType = res.headers?.get?.('content-type') ?? '';
    if (contentType && !/html/i.test(contentType)) return null;
    return (await res.text()).slice(0, 500_000);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Cached page fetch for listing discovery
// ---------------------------------------------------------------------------
//
// Both providers discover a listing from the same place website. Fetch it once
// per URL: single-flight de-dupes concurrent callers and a short TTL cache
// avoids repeat fetches across mounts, so the homepage is never fetched twice
// for one place. The POI website is not a provider host, so it is not paced by
// the provider browse scheduler.

const DISCOVERY_TTL_MS = 15 * 60 * 1000;
const DISCOVERY_MAX_ENTRIES = 100;
const DISCOVERY_TIMEOUT_MS = 4_000;

interface DiscoveryEntry {
  html: string | null;
  expiresAt: number;
}

const discoveryCache = new Map<string, DiscoveryEntry>();
const discoveryInflight = new Map<string, Promise<string | null>>();

/** Clear the discovery page cache (tests / teardown). */
export function clearDiscoveryCache(): void {
  discoveryCache.clear();
  discoveryInflight.clear();
}

/**
 * Fetch a place website's HTML for listing discovery, deduped and cached.
 * Concurrent callers for the same URL share a single request. Never rejects; a
 * failure resolves to null.
 */
export function fetchDiscoveryHtml(
  url: string,
  timeoutMs: number = DISCOVERY_TIMEOUT_MS,
): Promise<string | null> {
  const cached = discoveryCache.get(url);
  if (cached && Date.now() < cached.expiresAt) return Promise.resolve(cached.html);

  const inflight = discoveryInflight.get(url);
  if (inflight) return inflight;

  const request = fetchPageHtml(url, timeoutMs).then((html) => {
    discoveryCache.set(url, { html, expiresAt: Date.now() + DISCOVERY_TTL_MS });
    if (discoveryCache.size > DISCOVERY_MAX_ENTRIES) {
      const oldest = discoveryCache.keys().next().value;
      if (oldest !== undefined) discoveryCache.delete(oldest);
    }
    return html;
  });
  discoveryInflight.set(url, request);
  void request.finally(() => discoveryInflight.delete(url));
  return request;
}

// ---------------------------------------------------------------------------
// Shared anchor discovery
// ---------------------------------------------------------------------------

/**
 * Discover a provider listing URL from a page's anchors. Pure and unit-testable;
 * each provider supplies its own URL predicates.
 */
export function discoverListingFromAnchors(
  html: string,
  baseUrl: string,
  isProviderUrl: (raw: string) => boolean,
  parseListingUrl: (url: string) => string | null,
): string | null {
  const anchors = /<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((match = anchors.exec(html)) !== null) {
    const href = (match[1] ?? '').trim();
    if (!href) continue;
    let abs: URL;
    try {
      abs = new URL(href, baseUrl);
    } catch {
      continue;
    }
    if (!isProviderUrl(abs.toString())) continue;
    const canonical = parseListingUrl(abs.toString());
    if (canonical && !seen.has(canonical)) {
      seen.add(canonical);
      return canonical;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Generic WebView message parsers
// ---------------------------------------------------------------------------

interface WebViewRatingMessage {
  type?: unknown;
  provider?: unknown;
  ldRating?: unknown;
  ldCount?: unknown;
  ldName?: unknown;
  ldAddress?: unknown;
  geo?: unknown;
  automation?: unknown;
  challenge?: unknown;
}

function parseWebViewGeo(value: unknown): GeoPoint | null {
  if (!value || typeof value !== 'object') return null;
  const g = value as Record<string, unknown>;
  const lat =
    typeof g.lat === 'number' ? g.lat : typeof g.lat === 'string' ? parseFloat(g.lat) : NaN;
  const lng =
    typeof g.lng === 'number' ? g.lng : typeof g.lng === 'string' ? parseFloat(g.lng) : NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

/**
 * Parse a listing-stage WebView payload (`{ type: 'external-rating', … }`) into
 * the same RawExternalRating shape the fetch path produces, so both share one
 * validation pipeline.
 */
export function parseRatingMessageFromWebView(
  data: string,
  provider: ExternalRatingProviderId,
): RawExternalRating | null {
  let msg: WebViewRatingMessage;
  try {
    msg = JSON.parse(data) as WebViewRatingMessage;
  } catch {
    return null;
  }
  if (msg.type !== 'external-rating' || msg.provider !== provider) return null;

  const automation = Array.isArray(msg.automation)
    ? (msg.automation as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];
  const automationRating = automation
    .map(parseRatingFromStarText)
    .find((r): r is number => r != null);
  const automationCount = automation.map(parseExactCount).find((c): c is number => c != null);

  const ldRating = typeof msg.ldRating === 'number' ? msg.ldRating : null;
  const ldCount = typeof msg.ldCount === 'number' ? msg.ldCount : null;

  return {
    rating: ldRating ?? automationRating ?? null,
    reviewCount: ldCount ?? automationCount ?? null,
    listingName: typeof msg.ldName === 'string' ? msg.ldName : null,
    listingAddress: typeof msg.ldAddress === 'string' ? msg.ldAddress : null,
    geo: parseWebViewGeo(msg.geo),
    challenge: msg.challenge === true,
  };
}

/**
 * Parse a search-stage WebView payload (`{ type: 'rating-search', … }`) into
 * candidate listings.
 */
export function parseSearchMessageFromWebView(
  data: string,
  provider: ExternalRatingProviderId,
): RatingSearchCandidate[] | null {
  let msg: { type?: unknown; provider?: unknown; candidates?: unknown };
  try {
    msg = JSON.parse(data) as typeof msg;
  } catch {
    return null;
  }
  if (msg.type !== 'rating-search' || msg.provider !== provider) return null;
  if (!Array.isArray(msg.candidates)) return null;

  const out: RatingSearchCandidate[] = [];
  for (const raw of msg.candidates) {
    if (!raw || typeof raw !== 'object') continue;
    const c = raw as Record<string, unknown>;
    if (typeof c.url !== 'string' || !c.url) continue;
    const candidate: RatingSearchCandidate = {
      url: c.url,
      name: typeof c.name === 'string' ? c.name : null,
      address: typeof c.address === 'string' ? c.address : null,
      geo: parseWebViewGeo(c.geo),
    };
    if (typeof c.rating === 'number' && Number.isFinite(c.rating)) candidate.rating = c.rating;
    if (typeof c.reviewCount === 'number' && Number.isInteger(c.reviewCount)) {
      candidate.reviewCount = c.reviewCount;
    }
    out.push(candidate);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Retriable injected collector
// ---------------------------------------------------------------------------

/**
 * Build the standard injected-collector wrapper around a provider's `collect()`
 * body. Replaces the old one-shot `SENT` latch: the collector re-runs on an
 * interval until it has data or time runs out, so a page that is briefly
 * presenting a DataDome interstitial gets re-read once it clears (verified:
 * Yelp's interstitial auto-resolves within seconds in a warmed WebView).
 *
 * The generated script is ES5-compatible — it runs inside third-party pages.
 *
 * @param providerId    Value posted as `provider` on every message.
 * @param payloadType   `'external-rating'` or `'rating-search'`.
 * @param hasDataJs     ES5 expression, evaluated in page context; true when
 *                      `out` carries the data worth posting.
 * @param collectBodyJs ES5 statements that populate `out` from the DOM.
 * @param initialDelayMs / retryIntervalMs / maxAttempts — pacing.
 */
export function buildCollectorScript(opts: {
  providerId: string;
  payloadType: 'external-rating' | 'rating-search';
  hasDataJs: string;
  collectBodyJs: string;
  initialDelayMs?: number;
  retryIntervalMs?: number;
  maxAttempts?: number;
}): string {
  const initialDelayMs = opts.initialDelayMs ?? 0;
  const retryIntervalMs = opts.retryIntervalMs ?? 500;
  const maxAttempts = opts.maxAttempts ?? 20;
  return `(function () {
  var ATTEMPTS = ${JSON.stringify(maxAttempts)};
  var INTERVAL = ${JSON.stringify(retryIntervalMs)};
  var FIRST_DELAY = ${JSON.stringify(initialDelayMs)};
  var TYPE = ${JSON.stringify(opts.payloadType)};
  var PROVIDER = ${JSON.stringify(opts.providerId)};
  var SENT = false;
  function post(obj) {
    if (SENT) return;
    SENT = true;
    try { window.ReactNativeWebView.postMessage(JSON.stringify(obj)); } catch (e) {}
  }
  function collect() {
    var out = { type: TYPE, provider: PROVIDER };
${opts.collectBodyJs}
    var MARKERS = ['datadome', 'akamai', 'perimeterx', 'just a moment', 'cf-challenge', 'challenge-platform', 'attention required', 'verify you are human', 'are you a robot'];
    var low = document.body ? String(document.body.innerHTML).toLowerCase() : '';
    var markerHit = false;
    for (var mi = 0; mi < MARKERS.length; mi++) {
      if (low.indexOf(MARKERS[mi]) !== -1) { markerHit = true; break; }
    }
    var hasData = ${opts.hasDataJs};
    out.challenge = markerHit && !hasData;
    if (hasData) { post(out); return; }
    ATTEMPTS -= 1;
    if (ATTEMPTS > 0) { setTimeout(collect, INTERVAL); return; }
    // Attempts exhausted: post the final (possibly challenge/empty) state once
    // so the stage settles promptly instead of waiting out the controller
    // timeout — a collector SHALL post exactly once per page.
    post(out);
  }
  if (FIRST_DELAY > 0) { setTimeout(collect, FIRST_DELAY); } else { collect(); }
  return true;
})();`;
}

interface CacheEntry {
  summary: ExternalRatingSummary;
  expiresAt: number;
}

const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 200;
const ratingCache = new Map<string, CacheEntry>();

export function clearExternalRatingCache(): void {
  ratingCache.clear();
  clearDiscoveryCache();
}

function cacheKey(provider: ExternalRatingProviderId, listingUrl: string): string {
  return `${provider}:${listingUrl}`;
}

export function getCachedExternalRating(
  provider: ExternalRatingProviderId,
  listingUrl: string,
): ExternalRatingSummary | null {
  const entry = ratingCache.get(cacheKey(provider, listingUrl));
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    ratingCache.delete(cacheKey(provider, listingUrl));
    return null;
  }
  return entry.summary;
}

export function setCachedExternalRating(
  provider: ExternalRatingProviderId,
  listingUrl: string,
  summary: ExternalRatingSummary,
): void {
  if (ratingCache.size >= MAX_CACHE_ENTRIES) {
    const first = ratingCache.keys().next().value;
    if (first !== undefined) ratingCache.delete(first);
  }
  ratingCache.set(cacheKey(provider, listingUrl), {
    summary,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}
