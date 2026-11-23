/**
 * Yelp provider for on-device aggregate ratings.
 *
 * Yelp business ratings are JS-rendered, so the hidden WebView is the primary
 * path; a cheap fetch-path pre-parse reads JSON-LD `aggregateRating` and the
 * embedded `__NEXT_DATA__` script before falling back to the WebView. Only
 * Yelp's own web hosts are ever loaded (`yelp.com`, `www.yelp.com`, and the
 * `m.yelp.com` mobile host it redirects a mobile UA to) — direct listing
 * references only, no search-engine scraping, no CAPTCHA solving, no stealth.
 */

import {
  EXTERNAL_RATINGS_USER_AGENT,
  buildCollectorScript,
  COLLECTOR_INITIAL_DELAY_MS,
  COLLECTOR_MAX_ATTEMPTS,
  COLLECTOR_RETRY_INTERVAL_MS,
  discoverListingFromAnchors,
  extractLdBlocks,
  findAggregateRating,
  parseRatingMessageFromWebView,
  parseSearchMessageFromWebView,
  pageIsChallenge,
} from './core';
import type { ExternalRatingProvider } from './provider';
import type { GeoPoint, RawExternalRating, RatingSearchCandidate } from './types';

// ---------------------------------------------------------------------------
// Host allowlist + URL validation
// ---------------------------------------------------------------------------

/**
 * Yelp's own web hosts.
 *
 * `m.yelp.com` is not optional: with the mobile Safari user agent this browser
 * presents (the same one that makes TripAdvisor answer at all), Yelp answers a
 * `www.yelp.com` request with a redirect to `m.yelp.com`. Leaving it off the
 * allowlist made the navigation gate cancel that redirect, so every Yelp stage
 * loaded nothing and timed out — observed in the lag probe as
 * `loadStart … www.yelp.com/search` → `blockedNav … m.yelp.com/search`, with the
 * row settling as "Ratings couldn't load right now".
 */
export const YELP_ALLOWED_HOSTS = ['yelp.com', 'www.yelp.com', 'm.yelp.com'] as const;

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
  const ld = findAggregateRating(extractLdBlocks(html));
  const next = parseYelpNextDataRating(html);
  const dom = parseYelpDomFallback(html);

  const rating = ld.rating ?? next?.rating ?? dom.rating;
  const count = ld.count ?? next?.reviewCount ?? dom.count;
  if (rating == null || count == null) return null;

  // Markers alone are not a verdict: live Yelp pages carry DataDome scripts
  // while serving complete JSON-LD (verified against a real listing page).
  if (pageIsChallenge(html, true)) return null;

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
      const candidate: RatingSearchCandidate = {
        url: canonical,
        name,
        address: yelpAddress(o.location),
        geo: yelpGeo(o.coordinates),
      };
      const agg =
        o.aggregateRating && typeof o.aggregateRating === 'object'
          ? (o.aggregateRating as Record<string, unknown>)
          : null;
      const rating = asNumber(o.rating) ?? (agg ? asNumber(agg.ratingValue) : null);
      const count = asInt(o.reviewCount) ?? (agg ? asInt(agg.reviewCount) : null);
      if (rating != null) candidate.rating = rating;
      if (count != null) candidate.reviewCount = count;
      out.push(candidate);
    }
  }
  for (const v of Object.values(o)) scanSearchBusinesses(v, out, name);
}

/** Parse candidate listings from a Yelp search results page. */
export function parseYelpSearchResults(html: string, baseUrl: string): RatingSearchCandidate[] {
  const out: RatingSearchCandidate[] = [];

  const data = extractNextData(html);
  if (data) scanSearchBusinesses(data, out, null);

  const byUrl = new Map(out.map((c) => [c.url, c]));
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
    if (!canonical) continue;
    const name = (m[2] ?? '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
    const existing = byUrl.get(canonical);
    if (existing) {
      // Yelp renders an image anchor before the named link for a listing.
      // The first anchor is often empty; a later one carries the name.
      if (!existing.name && name) existing.name = name;
      continue;
    }
    const candidate = { url: canonical, name: name || null, address: null, geo: null };
    byUrl.set(canonical, candidate);
    out.push(candidate);
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

/** Listing-stage injected JS. Re-collects until data or attempts run out. */
export const YELP_RATING_JS = buildCollectorScript({
  providerId: 'yelp',
  payloadType: 'external-rating',
  hasDataJs: 'out.ldRating != null && out.ldCount != null && out.ldName != null',
  initialDelayMs: COLLECTOR_INITIAL_DELAY_MS,
  retryIntervalMs: COLLECTOR_RETRY_INTERVAL_MS,
  maxAttempts: COLLECTOR_MAX_ATTEMPTS,
  collectBodyJs: `    out.ldRating = null;
    out.ldCount = null;
    out.ldName = null;
    out.ldAddress = null;
    out.geo = null;
    out.automation = [];
    out.nodes = [];
    function typeOf(node) {
      var t = node['@type'];
      if (Object.prototype.toString.call(t) === '[object Array]') t = t.join(' ');
      return typeof t === 'string' ? t : '';
    }
    function addressOf(node) {
      if (!node.address) return null;
      if (typeof node.address === 'string') return node.address;
      var a = node.address;
      var line = [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode].filter ? null : null;
      var parts = [];
      if (a.streetAddress) parts.push(a.streetAddress);
      if (a.addressLocality) parts.push(a.addressLocality);
      if (a.addressRegion) parts.push(a.addressRegion);
      if (a.postalCode) parts.push(a.postalCode);
      return parts.length ? parts.join(', ') : null;
    }
    function geoOf(node) {
      if (!node.geo || node.geo.latitude == null || node.geo.longitude == null) return null;
      return { lat: Number(node.geo.latitude), lng: Number(node.geo.longitude) };
    }
    /**
     * The business name, never the name of whatever block happens to own the
     * aggregateRating: Yelp's mobile page emits a "Photo Grid" node that carries
     * a rating, and taking that name made every listing fail identity
     * ("identity mismatch on listing: Photo Grid"). Prefer a typed business
     * node, then the page title, and only then the rating node's own name.
     */
    function titleName() {
      var t = String(document.title || '').replace(/\\s*[|–—-]\\s*Yelp.*$/i, '');
      var first = t.split(/\\s*[|–—-]\\s*/)[0] || '';
      first = first.replace(/\\s*[-(]?\\s*[0-9][0-9,]*\\s*reviews?.*$/i, '').trim();
      if (!first || /^yelp/i.test(first)) return null;
      return first.slice(0, 120);
    }
    var BUSINESS_TYPE = /restaurant|localbusiness|foodestablishment|store|cafe|bar|bakery|nightclub|business/i;
    var business = null;
    var ratingOwnerName = null;
    var scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (var i = 0; i < scripts.length; i++) {
      try {
        var data = JSON.parse(scripts[i].textContent || 'null');
        var items = Object.prototype.toString.call(data) === '[object Array]' ? data : [data];
        for (var k = 0; k < items.length; k++) {
          var it = items[k];
          if (!it || typeof it !== 'object') continue;
          var arr = it.aggregateRating ? (Object.prototype.toString.call(it.aggregateRating) === '[object Array]' ? it.aggregateRating : [it.aggregateRating]) : [];
          var ownsRating = arr.length > 0;
          for (var a = 0; a < arr.length; a++) {
            if (out.ldRating == null && arr[a].ratingValue != null) out.ldRating = Number(arr[a].ratingValue);
            if (out.ldCount == null && arr[a].reviewCount != null) out.ldCount = Number(arr[a].reviewCount);
          }
          if (!arr.length) {
            if (it.ratingValue != null) { if (out.ldRating == null) out.ldRating = Number(it.ratingValue); ownsRating = true; }
            if (it.reviewCount != null) { if (out.ldCount == null) out.ldCount = Number(it.reviewCount); ownsRating = true; }
          }
          if (ownsRating && ratingOwnerName == null && typeof it.name === 'string' && it.name) {
            ratingOwnerName = it.name;
          }
          if (!business && typeof it.name === 'string' && it.name && BUSINESS_TYPE.test(typeOf(it))) {
            business = it;
          }
          if (out.nodes.length < 8) {
            out.nodes.push({
              type: typeOf(it).slice(0, 40),
              name: typeof it.name === 'string' ? it.name.slice(0, 60) : null,
              rating: arr.length > 0 || it.ratingValue != null,
              address: !!addressOf(it),
              geo: !!geoOf(it)
            });
          }
        }
      } catch (e) { /* malformed JSON-LD — ignore */ }
    }
    if (business) {
      out.ldName = business.name;
      out.ldAddress = addressOf(business);
      out.geo = geoOf(business);
    }

    /**
     * Identity from the page's Next.js payload.
     *
     * Yelp's MOBILE listing page (m.yelp.com, where a mobile user agent is sent)
     * carries only ItemList JSON-LD blocks — Photo Grid, Popular Dishes, Menu
     * Photos, Msite Vibe Check — and no business node, so the rating is
     * readable but the name/address/coordinates that prove which business it
     * belongs to are not. They do exist in the __NEXT_DATA__ payload, in the business
     * object itself, so that is where identity is read from.
     */
    var nextEl = document.getElementById('__NEXT_DATA__');
    var nextData = null;
    if (nextEl) {
      try { nextData = JSON.parse(nextEl.textContent || 'null'); } catch (e) { nextData = null; }
    }
    function findBusiness(v, depth, seen) {
      if (!v || typeof v !== 'object' || depth > 14) return null;
      if (seen.count > 4000) return null;
      seen.count += 1;
      if (Object.prototype.toString.call(v) === '[object Array]') {
        for (var i = 0; i < v.length; i++) {
          var fromArray = findBusiness(v[i], depth + 1, seen);
          if (fromArray) return fromArray;
        }
        return null;
      }
      var hasIdentity = v.coordinates || v.location || v.formattedAddress;
      if (typeof v.name === 'string' && v.name && hasIdentity) {
        return {
          name: v.name,
          coordinates: v.coordinates || null,
          location: v.location || null,
          rating: v.rating != null ? Number(v.rating) : null,
          count: v.reviewCount != null ? Number(v.reviewCount) : null
        };
      }
      var keys = Object.keys(v);
      for (var j = 0; j < keys.length; j++) {
        var found = findBusiness(v[keys[j]], depth + 1, seen);
        if (found) return found;
      }
      return null;
    }
    var bizInfo = findBusiness(nextData, 0, { count: 0 });
    if (bizInfo) {
      if (out.ldName == null || !out.geo || !out.ldAddress) {
        out.ldName = bizInfo.name;
        if (!out.geo && bizInfo.coordinates && bizInfo.coordinates.latitude != null) {
          out.geo = { lat: Number(bizInfo.coordinates.latitude), lng: Number(bizInfo.coordinates.longitude) };
        }
        if (!out.ldAddress) {
          var loc = bizInfo.location;
          if (loc && typeof loc === 'object') {
            if (typeof loc.formattedAddress === 'string') out.ldAddress = loc.formattedAddress;
            else {
              var parts = [];
              if (loc.address1) parts.push(loc.address1);
              if (loc.city) parts.push(loc.city);
              if (loc.state) parts.push(loc.state);
              if (parts.length) out.ldAddress = parts.join(', ');
            }
          } else if (typeof loc === 'string') {
            out.ldAddress = loc;
          }
        }
      }
      if (out.ldRating == null && bizInfo.rating != null) out.ldRating = bizInfo.rating;
      if (out.ldCount == null && bizInfo.count != null) out.ldCount = bizInfo.count;
    }
    if (out.nodes.length < 12) {
      out.nodes.push({
        type: 'next-business',
        name: bizInfo ? String(bizInfo.name).slice(0, 60) : null,
        rating: !!(bizInfo && bizInfo.rating != null),
        address: !!(bizInfo && bizInfo.location),
        geo: !!(bizInfo && bizInfo.coordinates)
      });
    }

    if (out.ldName == null) out.ldName = titleName();
    if (out.ldName == null) out.ldName = ratingOwnerName;

    /**
     * Identity from the page itself.
     *
     * The mobile listing page omits a business JSON-LD node, so the address and
     * coordinates that prove which business a rating belongs to are read from
     * where the page does publish them: the place:location / og meta tags and
     * the visible address block.
     */
    function metaContent(selector) {
      var el = document.querySelector(selector);
      return el ? el.getAttribute('content') : null;
    }
    if (!out.geo) {
      var latRaw = metaContent('meta[property="place:location:latitude"]') || metaContent('meta[property="og:latitude"]') || metaContent('meta[name="place:location:latitude"]');
      var lngRaw = metaContent('meta[property="place:location:longitude"]') || metaContent('meta[property="og:longitude"]') || metaContent('meta[name="place:location:longitude"]');
      var lat = parseFloat(latRaw || '');
      var lng = parseFloat(lngRaw || '');
      if (isFinite(lat) && isFinite(lng)) out.geo = { lat: lat, lng: lng };
    }
    var addressText = '';
    if (!out.ldAddress) {
      var addrEl = document.querySelector('address');
      if (!addrEl) addrEl = document.querySelector('[data-testid="business-address"]');
      addressText = addrEl ? String(addrEl.textContent || '').replace(/\s+/g, ' ').trim() : '';
      if (addressText) out.ldAddress = addressText.slice(0, 200);
    }
    if (out.nodes.length < 12) {
      out.nodes.push({
        type: 'page-identity',
        name: out.ldName ? String(out.ldName).slice(0, 40) : null,
        rating: !!(out.ldRating != null && out.ldCount != null),
        address: !!addressText,
        geo: !!out.geo
      });
    }
    out.pageTitle = String(document.title || '').slice(0, 200);
    /**
     * Address from the title.
     *
     * The mobile listing title ends with the business address
     * ("BUDDAKAN - Updated November 2026 - 4939 Reviews - 6995 Photos - 75 9th
     * Ave, New York"). Lifting that street line gives identity a real address to
     * match against the place, which is the same strict check used for a page
     * that publishes one in JSON-LD — so the weaker name+city fallback is only a
     * last resort.
     */
    if (!out.ldAddress && out.pageTitle) {
      var titleAddress = /(?:^|\\s-\\s)([0-9]{1,6} [^-]{2,50},[^-]{2,40})/.exec(out.pageTitle);
      if (titleAddress && titleAddress[1]) {
        var cleanedAddress = titleAddress[1].replace(/\\s+/g, ' ').trim();
        if (cleanedAddress.length >= 6) out.ldAddress = cleanedAddress.slice(0, 200);
      }
    }
    if (out.ldRating == null || out.ldCount == null) {
      var next = document.getElementById('__NEXT_DATA__');
      if (next) {
        try {
          var scan = function (v, name) {
            if (!v) return null;
            if (Object.prototype.toString.call(v) === '[object Array]') {
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
    if (out.ldCount == null) {
      var tm = /([0-9][0-9,]*)\\s*reviews?\\b/i.exec(document.title || '');
      if (tm) out.ldCount = parseInt(tm[1].replace(/,/g, ''), 10);
    }`,
});

/**
 * Search-stage injected JS. Re-collects until `/biz/` anchors appear (or
 * attempts run out). A DataDome interstitial auto-resolving in a warmed WebView
 * is re-read automatically instead of posting an empty list once.
 */
export const YELP_SEARCH_JS = buildCollectorScript({
  providerId: 'yelp',
  payloadType: 'rating-search',
  // Wait for a named candidate: the first anchor for a listing is often an
  // image with no text, and the name arrives on a later anchor.
  hasDataJs: 'out.candidates.length > 0 && out.candidates.some(function (c) { return !!c.name; })',
  initialDelayMs: COLLECTOR_INITIAL_DELAY_MS,
  retryIntervalMs: COLLECTOR_RETRY_INTERVAL_MS,
  maxAttempts: COLLECTOR_MAX_ATTEMPTS,
  collectBodyJs: `    out.candidates = [];
    var seen = {};
    var next = document.getElementById('__NEXT_DATA__');
    if (next) {
      try {
        var scanCards = function (v, name) {
          if (!v || out.candidates.length >= 20) return;
          if (Array.isArray(v)) {
            for (var ai = 0; ai < v.length; ai++) scanCards(v[ai], name);
            return;
          }
          if (typeof v !== 'object') return;
          var o = v;
          var nm = typeof o.name === 'string' ? o.name : name;
          var alias = typeof o.alias === 'string' ? o.alias : null;
          var webUrl = typeof o.webUrl === 'string' ? o.webUrl : null;
          var agg = (o.aggregateRating && typeof o.aggregateRating === 'object') ? o.aggregateRating : null;
          var rt = o.rating != null ? Number(o.rating) : (agg && agg.ratingValue != null ? Number(agg.ratingValue) : null);
          var ct = o.reviewCount != null ? Number(o.reviewCount) : (agg && agg.reviewCount != null ? Number(agg.reviewCount) : null);
          if (nm && (alias || webUrl)) {
            var base = webUrl || ('https://www.yelp.com/biz/' + alias);
            var u;
            try { u = new URL(base, location.href).toString(); } catch (e2) { u = null; }
            if (u && u.indexOf('/biz/') !== -1 && !seen[u]) {
              seen[u] = true;
              var cand = { url: u, name: nm, address: null, geo: null };
              if (o.location && typeof o.location === 'object') {
                cand.address = o.location.formattedAddress || [o.location.address1, o.location.city, o.location.state].filter(function (x) { return !!x; }).join(', ') || null;
              }
              if (o.coordinates && o.coordinates.latitude != null) {
                cand.geo = { lat: Number(o.coordinates.latitude), lng: Number(o.coordinates.longitude) };
              }
              if (rt != null) cand.rating = rt;
              if (ct != null) cand.reviewCount = ct;
              out.candidates.push(cand);
            }
          }
          var keys = Object.keys(o);
          for (var j = 0; j < keys.length; j++) scanCards(o[keys[j]], nm);
        };
        scanCards(JSON.parse(next.textContent || 'null'), null);
      } catch (e) { /* malformed next data — ignore */ }
    }
    if (out.candidates.length === 0) {
      var byUrl = {};
      var anchors = document.querySelectorAll('a[href*="/biz/"]');
      for (var i = 0; i < anchors.length && out.candidates.length < 20; i++) {
        var href = anchors[i].getAttribute('href') || '';
        var abs;
        try {
          var u = new URL(href, location.href);
          u.search = '';
          u.hash = '';
          abs = u.toString();
        } catch (e) { continue; }
        var text = (anchors[i].textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 160);
        var existing = byUrl[abs];
        if (existing) {
          // Yelp renders an image anchor before the named link for a listing.
          // Fill the name from a later anchor instead of dropping it.
          if (!existing.name && text) existing.name = text;
          continue;
        }
        var cand = { url: abs, name: text || null, address: null, geo: null };
        byUrl[abs] = cand;
        out.candidates.push(cand);
      }
    }`,
});

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
  // Mobile, like TripAdvisor — the only UA this browser can load Yelp with.
  // Yelp redirects a plain www request to its mobile site either way, and a
  // desktop UA on the mobile site is answered with a DataDome 403 (UA/fingerprint
  // mismatch inside WebKit). The mobile page publishes the rating but not the
  // business address/coordinates in JSON-LD, so identity is read from the page
  // itself (see the collector's meta/`address` fallbacks).
  userAgent: EXTERNAL_RATINGS_USER_AGENT,
  // Yelp's DataDome edge rejects plain app fetches with a 403; the hidden
  // browser is the only transport that can ever return a listing.
  supportsPlainFetch: false,
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
