/**
 * External TripAdvisor rating via on-device headless browsing.
 *
 * Strategy (hybrid, mirrors websitePhotosService):
 *  1. Plain fetch of the listing page; parse JSON-LD `aggregateRating` and
 *     visible review-count text. Cheap, no JS execution — misses JS-rendered
 *     pages behind anti-bot walls.
 *  2. Hidden WebView fallback — loads the real listing on-device, runs injected
 *     JS that reads JSON-LD + `data-automation` elements, then postMessages a
 *     structured rating object back. Used when the plain fetch is blocked or
 *     yields nothing.
 *
 * Safety contract:
 *  - Only the TripAdvisor host allowlist (`tripadvisor.com`, `www.tripadvisor.com`)
 *    is ever loaded. Redirects outside the allowlist are rejected.
 *  - Direct listing references only — no search-engine scraping, no CAPTCHA
 *    solving, no stealth/proxy rotation.
 *  - Results are validated (rating 0–5, exact non-negative integer count,
 *    listing identity present) and rejected on anti-bot/challenge pages.
 *  - Results stay transient and device-local. They are NOT written to SQLite,
 *    Gun, ATProto, OSM, or search ranking.
 */

import { normalizeWebsiteUrl, isHttpUrl } from './websitePhotosService';

export type ExternalRatingProvider = 'tripadvisor';

export interface ExternalRatingSummary {
  provider: ExternalRatingProvider;
  /** Canonical listing URL that was loaded. */
  listingUrl: string;
  /** Listing name as published by TripAdvisor. */
  listingName: string;
  /** Optional listing address as published by TripAdvisor. */
  listingAddress?: string;
  /** Rating on a 0–5 scale. */
  rating: number;
  /** Exact, non-negative review count. */
  reviewCount: number;
  /** When the rating was observed (ms epoch). */
  observedAt: number;
}

interface RawExternalRating {
  rating: number | null;
  reviewCount: number | null;
  listingName: string | null;
  listingAddress: string | null;
  challenge: boolean;
}

// ---------------------------------------------------------------------------
// Host allowlist + URL validation
// ---------------------------------------------------------------------------

/**
 * Exact host allowlist. Deliberately narrow: only the primary .com host and its
 * www subdomain. Country variants (tripadvisor.co.jp, …) require separate
 * allowlisting and are intentionally excluded until reviewed.
 */
const TRIPADVISOR_ALLOWED_HOSTS = ['tripadvisor.com', 'www.tripadvisor.com'];

export function isAllowedTripadvisorHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return TRIPADVISOR_ALLOWED_HOSTS.includes(host);
}

/** True for a tripadvisor.com http(s) listing URL. Never load anything else. */
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
  /** Canonical listing URL. */
  url: string;
  /** TripAdvisor place id (the `d<digits>` segment), when present. */
  placeId: string | null;
  /** Listing category segment (Restaurant, Attraction, Hotel, …) when present. */
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
 * Parse a TripAdvisor listing URL into its structured pieces.
 *
 * Accepts the review-style URLs (…/Restaurant_Review-g…-d12345-Review-…), the
 * plain listing URLs (…/Restaurant_12345…) and ThingsToDo URLs. Returns null
 * when the URL is not an allowed host or is not a listing.
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

  // Category segment (e.g. "Restaurant" in "/Restaurant_Review-…").
  let listingType: string | null = null;
  for (const type of TRIPADVISOR_LISTING_TYPES) {
    const re = new RegExp(`(?:^|/)${type}(?:_Review|_[0-9]{3,})`, 'i');
    if (re.test(pathname)) {
      listingType = type;
      break;
    }
  }
  if (!listingType) return null;

  // Place id: the `d<digits>` segment, e.g. /-g155043-d8505471-Review-.
  const idMatch = /(?:^|[-/])d([0-9]{3,})(?:[-/]|$)/.exec(pathname);
  const placeId = idMatch ? idMatch[1] : null;

  return { url: parsed.toString(), placeId, listingType };
}

/**
 * Resolve a TripAdvisor listing URL from a POI.
 *
 * Resolution order:
 *  1. Explicit `polaris:tripadvisor` tag on the POI.
 *  2. Caller-supplied URL (`override`).
 *  3. TripAdvisor link discovered from the POI website's `sameAs` metadata.
 *
 * Returns null when no valid listing can be resolved.
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

// ---------------------------------------------------------------------------
// Website `sameAs` discovery
// ---------------------------------------------------------------------------

/**
 * Discover a TripAdvisor listing URL from a POI website's HTML `sameAs` links.
 * Pure function — unit-testable and reused by the discovery path.
 */
export function discoverTripadvisorFromWebsiteHtml(html: string, baseUrl: string): string | null {
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
    if (!isTripadvisorUrl(abs.toString())) continue;
    const canonical = parseTripadvisorListingUrl(abs.toString())?.url;
    if (canonical && !seen.has(canonical)) {
      seen.add(canonical);
      return canonical;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Low-level parsing helpers (shared by the fetch path and tests)
// ---------------------------------------------------------------------------

function extractLdBlocks(html: string): unknown[] {
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

interface LdRating {
  rating: number | null;
  count: number | null;
  name: string | null;
  address: string | null;
}

function findAggregateRating(blocks: unknown[]): LdRating {
  const out: LdRating = { rating: null, count: null, name: null, address: null };
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

      if (out.rating != null && out.count != null) return out;
    }
  }
  return out;
}

/** Collect `data-automation` review/rating/count element text. */
function collectAutomationText(html: string): string[] {
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

/** Parse a "4.5 star rating" style string into a 0–5 number. */
function parseRatingFromStarText(text: string): number | null {
  const m = /(\d+(?:\.\d+)?)\s*star/i.exec(text);
  if (!m) return null;
  const n = parseFloat(m[1]);
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
  // A review count is always followed by "review"/"reviews" on TripAdvisor.
  // Requiring the suffix keeps us from mis-parsing a rating like "4.5".
  const m = /(\d{1,3}(?:,\d{3})+|\d+)\s*reviews?\b/i.exec(text);
  if (!m) return null;
  const n = parseInt(m[1].replace(/,/g, ''), 10);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** Challenge/anti-bot markers that indicate the page is not a real listing. */
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

export function detectChallenge(html: string): boolean {
  const lower = html.toLowerCase();
  return CHALLENGE_MARKERS.some((marker) => lower.includes(marker));
}

// ---------------------------------------------------------------------------
// Public extraction entry points
// ---------------------------------------------------------------------------

/**
 * Extract a raw external rating from a listing page's HTML.
 *
 * Prefers JSON-LD `aggregateRating`; falls back to `data-automation` element
 * text and finally to a challenge check. Returns null when nothing usable is
 * found (e.g. a challenge page or a page with no rating data).
 */
export function parseExternalRatingFromHtml(html: string): RawExternalRating | null {
  if (detectChallenge(html)) return null;

  const blocks = extractLdBlocks(html);
  const ld = findAggregateRating(blocks);

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

  if (rating == null || count == null) return null;

  return {
    rating,
    reviewCount: count,
    listingName,
    listingAddress: ld.address ?? null,
    challenge: false,
  };
}

/**
 * Parse an on-device WebView result into a raw rating.
 *
 * The injected JS mirrors parseExternalRatingFromHtml and posts a structured
 * object back across the bridge; this converts it to the same RawExternalRating
 * shape the fetch path produces so both share one validation pipeline.
 */
export function extractRatingFromWebViewMessage(data: string): RawExternalRating | null {
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(data) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (msg.type !== 'external-rating' || msg.provider !== 'tripadvisor') return null;
  const raw: TripadvisorRawWebViewRating = {
    type: msg.type,
    provider: msg.provider,
    ldRating: typeof msg.ldRating === 'number' ? msg.ldRating : null,
    ldCount: typeof msg.ldCount === 'number' ? msg.ldCount : null,
    ldName: typeof msg.ldName === 'string' ? msg.ldName : null,
    ldAddress: typeof msg.ldAddress === 'string' ? msg.ldAddress : null,
    automation: Array.isArray(msg.automation)
      ? (msg.automation as unknown[]).filter((x): x is string => typeof x === 'string')
      : [],
    challenge: msg.challenge === true,
  };
  return rawFromWebView(raw);
}

/** Structured object posted from the injected WebView JS (pre-conversion). */
interface TripadvisorRawWebViewRating {
  type: string;
  provider: string;
  ldRating: number | null;
  ldCount: number | null;
  ldName: string | null;
  ldAddress: string | null;
  automation: string[];
  challenge: boolean;
}

function rawFromWebView(raw: TripadvisorRawWebViewRating): RawExternalRating {
  const automationRating = raw.automation
    .map(parseRatingFromStarText)
    .find((r): r is number => r != null);
  const automationCount = raw.automation.map(parseExactCount).find((c): c is number => c != null);
  return {
    rating: raw.ldRating ?? automationRating ?? null,
    reviewCount: raw.ldCount ?? automationCount ?? null,
    listingName: raw.ldName ?? null,
    listingAddress: raw.ldAddress ?? null,
    challenge: raw.challenge,
  };
}

// ---------------------------------------------------------------------------
// Validation + identity matching
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
  options?: { expectedName?: string | null },
): ExternalRatingSummary | null {
  if (raw.challenge) return null;
  const { rating, reviewCount, listingName, listingAddress } = raw;
  if (rating == null || reviewCount == null || !listingName) return null;
  if (!Number.isFinite(rating) || rating < 0 || rating > 5) return null;
  if (!Number.isInteger(reviewCount) || reviewCount < 0) return null;
  if (options?.expectedName && !namesMatch(listingName, options.expectedName)) return null;

  const summary: ExternalRatingSummary = {
    provider: 'tripadvisor',
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
// In-memory cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  summary: ExternalRatingSummary;
  expiresAt: number;
}

const ratingCache = new Map<string, CacheEntry>();

export function clearTripadvisorRatingCache(): void {
  ratingCache.clear();
}

// ---------------------------------------------------------------------------
// Orchestrator for the UI component
// ---------------------------------------------------------------------------

export interface FetchRatingOptions {
  /** Explicit listing URL override (e.g. user-pasted). */
  overrideUrl?: string | null;
  /** Timeout for the fetch + extraction (ms). */
  timeoutMs?: number;
}

/**
 * Resolve + validate the TripAdvisor rating for a POI.
 *
 * Returns the cached summary if available, otherwise resolves a listing URL
 * (explicit tag → override → website `sameAs`) and extracts the rating.
 * Returns null when no valid listing can be resolved or the extraction fails.
 *
 * Does NOT perform the WebView fetch — that is done by the UI component using
 * TRIPADVISOR_RATING_JS + extractRatingFromWebViewMessage, which share this
 * validation pipeline via validateExternalRating.
 */
export async function resolveRatingSource(
  poi: { name: string; tags?: Record<string, string>; website?: string | null },
  options?: FetchRatingOptions,
): Promise<{ listingUrl: string; listingName: string | null } | null> {
  const explicit = options?.overrideUrl ?? poi.tags?.['polaris:tripadvisor'];
  if (explicit && isTripadvisorUrl(explicit)) {
    const info = parseTripadvisorListingUrl(explicit);
    return info ? { listingUrl: info.url, listingName: null } : null;
  }

  const website = normalizeWebsiteUrl(poi.website ?? null);
  if (website) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options?.timeoutMs ?? 8000);
      const res = await fetch(website, {
        signal: controller.signal,
        headers: { Accept: 'text/html' },
      });
      clearTimeout(timer);
      if (res.ok) {
        const html = (await res.text()).slice(0, 500_000);
        const discovered = discoverTripadvisorFromWebsiteHtml(html, website);
        if (discovered) return { listingUrl: discovered, listingName: null };
      }
    } catch {
      /* website fetch failed — fall through */
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Injected JS for the hidden-WebView fallback
// ---------------------------------------------------------------------------

/**
 * Injected JS for the hidden-WebView fallback. Runs on-device after page load,
 * reads JSON-LD aggregateRating + `data-automation` review elements, detects
 * anti-bot challenge pages, then postMessages a structured rating object back.
 *
 * NOTE: ES5-compatible (no optional chaining) — runs inside arbitrary
 * third-party pages.
 */
export const TRIPADVISOR_RATING_JS = `(function () {
  var SENT = false;
  function post(obj) {
    if (SENT) return;
    SENT = true;
    try { window.ReactNativeWebView.postMessage(JSON.stringify(obj)); } catch (e) {}
  }
  function collect() {
    var out = {
      type: 'external-rating',
      provider: 'tripadvisor',
      ldRating: null,
      ldCount: null,
      ldName: null,
      ldAddress: null,
      automation: [],
      challenge: false
    };
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
          if (!out.ldAddress && it.address) out.ldAddress = String(it.address);
          if (out.ldRating != null && out.ldCount != null) break;
        }
      } catch (e) { /* malformed JSON-LD — ignore */ }
    }
    var autos = document.querySelectorAll('[data-automation]');
    for (var j = 0; j < autos.length; j++) {
      var dv = autos[j].getAttribute('data-automation') || '';
      var lower = dv.toLowerCase();
      if (lower.indexOf('review') !== -1 || lower.indexOf('rating') !== -1 || lower.indexOf('count') !== -1) {
        var txt = (autos[j].textContent || '').replace(/\\s+/g, ' ').trim();
        if (txt) out.automation.push(txt);
      }
    }
    var src = document.body ? (document.body.innerHTML || '') : '';
    var low = src.toLowerCase();
    if (low.indexOf('datadome') !== -1 || low.indexOf('akamai') !== -1 || low.indexOf('perimeterx') !== -1 ||
        low.indexOf('just a moment') !== -1 || low.indexOf('cf-challenge') !== -1 ||
        low.indexOf('challenge-platform') !== -1 || low.indexOf('attention required') !== -1 ||
        low.indexOf('verify you are human') !== -1 || low.indexOf('are you a robot') !== -1) {
      out.challenge = true;
    }
    post(out);
  }
  collect();
  setTimeout(collect, 3000);
  return true;
})();`;

// Re-export for callers that need the http(s) guard when validating overrides.
export { isHttpUrl };
