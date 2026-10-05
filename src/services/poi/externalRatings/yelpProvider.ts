/**
 * Yelp provider for on-device aggregate ratings.
 *
 * Yelp business ratings are JS-rendered, so the hidden WebView is the primary
 * path; a cheap fetch-path pre-parse reads JSON-LD `aggregateRating` and the
 * embedded `__NEXT_DATA__` script before falling back to the WebView. Only
 * `yelp.com` / `www.yelp.com` are ever loaded — direct listing references only,
 * no search-engine scraping, no CAPTCHA solving, no stealth.
 */

import {
  detectChallenge,
  discoverListingFromAnchors,
  extractLdBlocks,
  findAggregateRating,
  parseRatingMessageFromWebView,
  parseSearchMessageFromWebView,
} from './core';
import type { ExternalRatingProvider } from './provider';
import type { GeoPoint, RawExternalRating, RatingSearchCandidate } from './types';

// ---------------------------------------------------------------------------
// Host allowlist + URL validation
// ---------------------------------------------------------------------------

export const YELP_ALLOWED_HOSTS = ['yelp.com', 'www.yelp.com'] as const;

export function isAllowedYelpHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return (YELP_ALLOWED_HOSTS as readonly string[]).includes(host);
}

/** True for a yelp.com http(s) URL. */
export function isYelpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return (u.protocol === 'https:' || u.protocol === 'http:') && isAllowedYelpHost(u.hostname);
  } catch {
    return false;
  }
}

/** Canonical business listing URL (`/biz/<slug>`), or null when not a listing. */
export function canonicalYelpListingUrl(url: string): string | null {
  if (!isYelpUrl(url)) return null;
  try {
    const u = new URL(url);
    if (!u.pathname.startsWith('/biz/')) return null;
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

/** Resolve a Yelp listing URL from a POI's explicit `polaris:yelp` tag/override. */
export function resolveYelpUrl(
  poi: { name: string; tags?: Record<string, string>; website?: string | null },
  options?: { overrideUrl?: string | null },
): string | null {
  const explicit = options?.overrideUrl ?? poi.tags?.['polaris:yelp'];
  if (explicit && isYelpUrl(explicit)) {
    return canonicalYelpListingUrl(explicit);
  }
  return null;
}

/** Discover a Yelp listing URL from a POI website's HTML anchors. */
export function discoverYelpFromWebsiteHtml(html: string, baseUrl: string): string | null {
  return discoverListingFromAnchors(html, baseUrl, isYelpUrl, canonicalYelpListingUrl);
}

// ---------------------------------------------------------------------------
// Shared JSON helpers
// ---------------------------------------------------------------------------

function asNumber(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function asInt(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseInt(v, 10) : NaN;
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function yelpAddress(location: unknown): string | null {
  if (!location || typeof location !== 'object') return null;
  const l = location as Record<string, unknown>;
  if (typeof l.formattedAddress === 'string') return l.formattedAddress;
  const parts = [l.address1, l.address2, l.city, l.state, l.zipCode].filter(
    (p): p is string => typeof p === 'string' && p.length > 0,
  );
  return parts.length ? parts.join(', ') : null;
}

function yelpGeo(coords: unknown): GeoPoint | null {
  if (!coords || typeof coords !== 'object') return null;
  const c = coords as Record<string, unknown>;
  const lat = asNumber(c.latitude);
  const lng = asNumber(c.longitude);
  return lat != null && lng != null ? { lat, lng } : null;
}

// ---------------------------------------------------------------------------
// `__NEXT_DATA__` parsing
// ---------------------------------------------------------------------------

function extractNextData(html: string): unknown | null {
  const m = /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i.exec(html);
  if (!m) return null;
  try {
    return JSON.parse(m[1] ?? 'null');
  } catch {
    return null;
  }
}

interface BusinessScan {
  rating: number;
  count: number;
  name: string | null;
  address: string | null;
  geo: GeoPoint | null;
}

/** Depth-first search for the first object carrying both a rating and a count. */
function scanBusiness(value: unknown, inheritedName: string | null): BusinessScan | null {
  if (Array.isArray(value)) {
    for (const v of value) {
      const found = scanBusiness(v, inheritedName);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;

  const o = value as Record<string, unknown>;
  const name = typeof o.name === 'string' ? o.name : inheritedName;
  const agg =
    o.aggregateRating && typeof o.aggregateRating === 'object'
      ? (o.aggregateRating as Record<string, unknown>)
      : null;
  const rating =
    asNumber(o.rating) ?? asNumber(o.ratingValue) ?? (agg ? asNumber(agg.ratingValue) : null);
  const count = asInt(o.reviewCount) ?? (agg ? asInt(agg.reviewCount) : null);

  if (rating != null && count != null) {
    return {
      rating,
      count,
      name,
      address: yelpAddress(o.location),
      geo: yelpGeo(o.coordinates),
    };
  }

  for (const v of Object.values(o)) {
    const found = scanBusiness(v, name);
    if (found) return found;
  }
  return null;
}

/** Parse an aggregate rating from the embedded `__NEXT_DATA__` script. */
export function parseYelpNextDataRating(html: string): RawExternalRating | null {
  const data = extractNextData(html);
  if (!data) return null;
  const biz = scanBusiness(data, null);
  if (!biz) return null;
  return {
    rating: biz.rating,
    reviewCount: biz.count,
    listingName: biz.name,
    listingAddress: biz.address,
    geo: biz.geo,
    challenge: false,
  };
}

// ---------------------------------------------------------------------------
// Fetch-path rating extraction
// ---------------------------------------------------------------------------

function parseYelpDomFallback(html: string): { rating: number | null; count: number | null } {
  const aria = /aria-label=["']([0-9.]+)\s*star rating["']/i.exec(html);
  const rating = aria ? parseFloat(aria[1] as string) : null;
  const countM = /([0-9][0-9,]*)\s*reviews?\b/i.exec(html.replace(/<[^>]*>/g, ' '));
  const count = countM ? parseInt((countM[1] as string).replace(/,/g, ''), 10) : null;
  return {
    rating: rating != null && Number.isFinite(rating) ? rating : null,
    count: count != null && Number.isInteger(count) ? count : null,
  };
}

/**
 * Extract a raw external rating from a Yelp business page's HTML.
 * Order: JSON-LD → `__NEXT_DATA__` → DOM fallback.
 */
export function parseYelpRatingFromHtml(html: string): RawExternalRating | null {
  if (detectChallenge(html)) return null;

  const ld = findAggregateRating(extractLdBlocks(html));
  const next = parseYelpNextDataRating(html);
  const dom = parseYelpDomFallback(html);

  const rating = ld.rating ?? next?.rating ?? dom.rating;
  const count = ld.count ?? next?.reviewCount ?? dom.count;
  if (rating == null || count == null) return null;

  return {
    rating,
    reviewCount: count,
    listingName: ld.name ?? next?.listingName ?? null,
    listingAddress: ld.address ?? next?.listingAddress ?? null,
    geo: ld.geo ?? next?.geo ?? null,
    challenge: false,
  };
}

// ---------------------------------------------------------------------------
// Search-page parsing
// ---------------------------------------------------------------------------

function scanSearchBusinesses(
  value: unknown,
  out: RatingSearchCandidate[],
  inheritedName: string | null,
): void {
  if (out.length >= 20) return;
  if (Array.isArray(value)) {
    for (const v of value) scanSearchBusinesses(v, out, inheritedName);
    return;
  }
  if (!value || typeof value !== 'object') return;

  const o = value as Record<string, unknown>;
  const name = typeof o.name === 'string' ? o.name : inheritedName;
  const alias = typeof o.alias === 'string' ? o.alias : null;
  const webUrl = typeof o.webUrl === 'string' ? o.webUrl : null;
  if (name && (alias || webUrl)) {
    const canonical = canonicalYelpListingUrl(webUrl ?? `https://www.yelp.com/biz/${alias}`);
    if (canonical) {
      out.push({
        url: canonical,
        name,
        address: yelpAddress(o.location),
        geo: yelpGeo(o.coordinates),
      });
    }
  }
  for (const v of Object.values(o)) scanSearchBusinesses(v, out, name);
}

/** Parse candidate listings from a Yelp search results page. */
export function parseYelpSearchResults(html: string, baseUrl: string): RatingSearchCandidate[] {
  const out: RatingSearchCandidate[] = [];

  const data = extractNextData(html);
  if (data) scanSearchBusinesses(data, out, null);

  const seen = new Set(out.map((c) => c.url));
  const anchorRe = /<a\b[^>]*href=["']([^"']*\/biz\/[^"']*)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null && out.length < 20) {
    let abs: URL;
    try {
      abs = new URL(m[1] as string, baseUrl);
    } catch {
      continue;
    }
    const canonical = canonicalYelpListingUrl(abs.toString());
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

/** Build a Yelp search URL for a place name + address. */
export function buildYelpSearchUrl(name: string, address: string | null): string {
  const params = new URLSearchParams();
  params.set('find_desc', name);
  if (address) params.set('find_loc', address);
  return `https://www.yelp.com/search?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Injected JS for the hidden-WebView stages
// ---------------------------------------------------------------------------

/** Listing-stage injected JS. ES5-compatible — runs inside a third-party page. */
export const YELP_RATING_JS = `(function () {
  var SENT = false;
  function post(obj) {
    if (SENT) return;
    SENT = true;
    try { window.ReactNativeWebView.postMessage(JSON.stringify(obj)); } catch (e) {}
  }
  function collect() {
    var out = {
      type: 'external-rating',
      provider: 'yelp',
      ldRating: null,
      ldCount: null,
      ldName: null,
      ldAddress: null,
      geo: null,
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
          if (!out.ldAddress && it.address) out.ldAddress = typeof it.address === 'string' ? it.address : (it.address.streetAddress || null);
          if (!out.geo && it.geo && it.geo.latitude != null) out.geo = { lat: Number(it.geo.latitude), lng: Number(it.geo.longitude) };
        }
      } catch (e) { /* malformed JSON-LD — ignore */ }
    }
    if (out.ldRating == null || out.ldCount == null) {
      var next = document.getElementById('__NEXT_DATA__');
      if (next) {
        try {
          var scan = function (v, name) {
            if (!v) return null;
            if (Array.isArray(v)) {
              for (var i = 0; i < v.length; i++) { var r = scan(v[i], name); if (r) return r; }
              return null;
            }
            if (typeof v !== 'object') return null;
            var nm = typeof v.name === 'string' ? v.name : name;
            var agg = (v.aggregateRating && typeof v.aggregateRating === 'object') ? v.aggregateRating : null;
            var rt = v.rating != null ? Number(v.rating) : (v.ratingValue != null ? Number(v.ratingValue) : (agg && agg.ratingValue != null ? Number(agg.ratingValue) : null));
            var ct = v.reviewCount != null ? Number(v.reviewCount) : (agg && agg.reviewCount != null ? Number(agg.reviewCount) : null);
            if (rt != null && ct != null) return { rating: rt, count: ct, name: nm, location: v.location, coordinates: v.coordinates };
            var keys = Object.keys(v);
            for (var j = 0; j < keys.length; j++) { var rr = scan(v[keys[j]], nm); if (rr) return rr; }
            return null;
          };
          var biz = scan(JSON.parse(next.textContent || 'null'), null);
          if (biz) {
            if (out.ldRating == null) out.ldRating = biz.rating;
            if (out.ldCount == null) out.ldCount = biz.count;
            if (out.ldName == null && biz.name) out.ldName = biz.name;
            if (!out.geo && biz.coordinates && biz.coordinates.latitude != null) out.geo = { lat: Number(biz.coordinates.latitude), lng: Number(biz.coordinates.longitude) };
            if (!out.ldAddress && biz.location) {
              out.ldAddress = biz.location.formattedAddress || [biz.location.address1, biz.location.city, biz.location.state].filter(function (x) { return !!x; }).join(', ') || null;
            }
          }
        } catch (e) { /* malformed next data — ignore */ }
      }
    }
    if (out.ldRating == null) {
      var aria = document.querySelector('[aria-label*="star rating" i]');
      if (aria) {
        var am = /([0-9.]+)\\s*star/i.exec(aria.getAttribute('aria-label') || '');
        if (am) out.ldRating = Number(am[1]);
      }
    }
    if (out.ldCount == null && document.body) {
      var bodyTxt = (document.body.innerText || '').replace(/\\s+/g, ' ');
      var cm = /([0-9][0-9,]*)\\s*reviews?\\b/i.exec(bodyTxt);
      if (cm) out.ldCount = parseInt(cm[1].replace(/,/g, ''), 10);
    }
    var src = document.body ? (document.body.innerHTML || '') : '';
    var low = src.toLowerCase();
    var markers = ['datadome', 'akamai', 'perimeterx', 'just a moment', 'cf-challenge', 'challenge-platform', 'attention required', 'verify you are human', 'are you a robot'];
    for (var mi = 0; mi < markers.length; mi++) {
      if (low.indexOf(markers[mi]) !== -1) { out.challenge = true; break; }
    }
    post(out);
  }
  collect();
  setTimeout(collect, 3000);
  return true;
})();`;

/** Search-stage injected JS. ES5-compatible — runs inside a third-party page. */
export const YELP_SEARCH_JS = `(function () {
  var SENT = false;
  function post(obj) {
    if (SENT) return;
    SENT = true;
    try { window.ReactNativeWebView.postMessage(JSON.stringify(obj)); } catch (e) {}
  }
  function collect() {
    var out = { type: 'rating-search', provider: 'yelp', candidates: [] };
    var seen = {};
    var anchors = document.querySelectorAll('a[href*="/biz/"]');
    for (var i = 0; i < anchors.length && out.candidates.length < 20; i++) {
      var href = anchors[i].getAttribute('href') || '';
      var abs;
      try { abs = new URL(href, location.href).toString(); } catch (e) { continue; }
      if (seen[abs]) continue;
      seen[abs] = true;
      var name = (anchors[i].textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120);
      out.candidates.push({ url: abs, name: name || null, address: null, geo: null });
    }
    post(out);
  }
  collect();
  setTimeout(collect, 2500);
  return true;
})();`;

export function extractYelpRatingFromWebViewMessage(data: string): RawExternalRating | null {
  return parseRatingMessageFromWebView(data, 'yelp');
}

export function extractYelpSearchFromWebViewMessage(data: string): RatingSearchCandidate[] | null {
  return parseSearchMessageFromWebView(data, 'yelp');
}

/** The Yelp provider adapter. */
export const yelpProvider: ExternalRatingProvider = {
  id: 'yelp',
  allowedHosts: YELP_ALLOWED_HOSTS,
  isProviderUrl: isYelpUrl,
  parseListingUrl: canonicalYelpListingUrl,
  discoverFromWebsiteHtml: discoverYelpFromWebsiteHtml,
  buildSearchUrl: buildYelpSearchUrl,
  parseSearchResults: parseYelpSearchResults,
  parseRatingFromHtml: parseYelpRatingFromHtml,
  listingJs: YELP_RATING_JS,
  searchJs: YELP_SEARCH_JS,
  parseRatingMessage: extractYelpRatingFromWebViewMessage,
  parseSearchMessage: extractYelpSearchFromWebViewMessage,
};
