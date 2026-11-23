/**
 * Website photos via on-device headless browsing.
 *
 * Strategy (hybrid):
 *  1. `fetchWebsitePhotos()` — plain fetch of the homepage plus likely photo
 *     subpages (gallery/photos/menu), parsing OpenGraph `<meta>` AND `<img>`
 *     tags. Cheap, no JS execution; misses JS-rendered sites.
 *  2. Hidden WebView fallback — loads the real page on-device and extracts
 *     `og:image` / `twitter:image` / large `<img>` / CSS backgrounds via
 *     injected JS.
 *
 * Only http(s) URLs are ever loaded. Results are cached in-memory.
 */

const MAX_PHOTOS = 10;
const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 100;

/**
 * Hard cap on the HTML handed to the parser.
 *
 * This is the only byte budget that matters for the JS thread: the parser runs
 * on Hermes (no JIT on iOS) and every KB is scanned several times. 300 KB keeps
 * a worst-case page under a few hundred ms of *total* work, which the sliced
 * parser below then spreads across frames.
 */
const MAX_PARSE_BYTES = 300_000;

/** How much HTML one parse slice sees. */
const PARSE_SLICE_BYTES = 48 * 1024;
/** Overlap, so a tag straddling a slice boundary is still matched whole. */
const PARSE_SLICE_OVERLAP = 4 * 1024;
/** Longest stretch of parsing before the parser yields to the event loop. */
const PARSE_SLICE_BUDGET_MS = 6;

/**
 * Identifying User-Agent for scrapes. React Native supplies a default
 * (`<App>/<ver> CFNetwork/…`), but several venue WAFs (notably Squarespace)
 * reject requests with no UA outright, so send one explicitly — matching the
 * other network services in the repo.
 */
const USER_AGENT = 'PolarisMaps/1.0';

interface CacheEntry {
  urls: string[];
  expiresAt: number;
}

const photoCache = new Map<string, CacheEntry>();

export function clearWebsitePhotosCache(): void {
  photoCache.clear();
}

function getCached(url: string): string[] | null {
  const entry = photoCache.get(url);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    photoCache.delete(url);
    return null;
  }
  return entry.urls;
}

function setCached(url: string, urls: string[]): void {
  if (photoCache.size >= MAX_CACHE_ENTRIES) {
    const first = photoCache.keys().next().value;
    if (first !== undefined) photoCache.delete(first);
  }
  photoCache.set(url, { urls, expiresAt: Date.now() + CACHE_TTL_MS });
}

/** True for http(s) URLs only — never load data:, blob:, file:, etc. */
export function isHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Normalize a POI website tag value into a loadable http(s) URL.
 * Prepends https:// when no scheme is present. Returns null when unusable.
 */
export function normalizeWebsiteUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
  if (!isHttpUrl(withScheme)) return null;
  try {
    return new URL(withScheme).toString();
  } catch {
    return null;
  }
}

function withHost(url: URL, host: string, protocol: string): string {
  const next = new URL(url.toString());
  next.protocol = protocol;
  next.hostname = host;
  return next.toString();
}

/**
 * Ordered candidate page URLs to try for a website tag value.
 *
 * The tagged URL comes first (so its own redirects are followed, which is how
 * most `http://` apex tags reach the canonical `https://www.` host). Then the
 * `www.`/apex sibling over https, then the sibling over http. This rescues the
 * common hosting setup where the apex host serves a mismatched certificate or
 * one load-balanced node redirects to a dead host, while `www.` works.
 */
export function photoPageCandidates(rawUrl: string | null | undefined): string[] {
  const base = normalizeWebsiteUrl(rawUrl);
  if (!base) return [];
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return [];
  }
  const host = url.hostname.toLowerCase();
  const apex = host.startsWith('www.') ? host.slice(4) : host;
  const siblings = host.startsWith('www.') ? [apex] : host ? [`www.${host}`] : [];
  const out: string[] = [];
  const push = (candidate: string): void => {
    if (candidate && !out.includes(candidate)) out.push(candidate);
  };
  push(base);
  for (const h of [host, ...siblings]) push(withHost(url, h, 'https:'));
  // The apex over plain http too: an old domain whose https certificate is
  // broken (or unset) often still answers http with a redirect to the venue's
  // current site, so this is the only candidate that reaches it.
  for (const h of [apex, ...siblings]) push(withHost(url, h, 'http:'));
  return out;
}

/**
 * Resolve a possibly-relative image src against the page URL.
 * Returns null for non-http(s) targets (data:, blob:, …) and SVGs/icons.
 * Upgrades http: → https: — image display is broken for cleartext URLs on
 * iOS (ATS) anyway, and virtually all modern image CDNs serve TLS.
 */
export function resolvePhotoUrl(src: string, baseUrl: string): string | null {
  const trimmed = src.trim();
  if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) return null;
  try {
    const url = new URL(trimmed, baseUrl);
    if (url.protocol === 'http:') url.protocol = 'https:';
    if (url.protocol !== 'https:') return null;
    // Skip vector icons / favicons by extension.
    const path = url.pathname.toLowerCase();
    if (path.endsWith('.svg') || path.endsWith('.ico')) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Dedupe key: same photo served with different resize/format query params
 * (e.g. Squarespace `?format=300w` vs `?format=1500w`) must collapse.
 */
export function photoDedupeKey(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname.toLowerCase()}`;
  } catch {
    return url;
  }
}

/** True when the URL looks like a logo/icon/placeholder rather than a photo. */
export function isLogoLikeUrl(url: string): boolean {
  const haystack = url.toLowerCase();
  return /logo|icon|favicon|sprite|placeholder|blank|pixel|badge|avatar|spinner|loading|default-image/.test(
    haystack,
  );
}

/** Dedupe (query-insensitive) preserving order, capped at `limit`. */
export function dedupePhotoUrls(
  urls: Array<string | null | undefined>,
  limit: number = MAX_PHOTOS,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    if (!u) continue;
    const key = photoDedupeKey(u);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(u);
    if (out.length >= limit) break;
  }
  return out;
}

/** Stable rank: real photos first, logos/placeholders last. */
export function rankPhotoUrls(urls: string[]): string[] {
  return [...urls].sort((a, b) => Number(isLogoLikeUrl(a)) - Number(isLogoLikeUrl(b)));
}

/** Extract a meta/link content/href attribute value (order-independent attrs). */
function extractMetaContent(html: string, attrName: string, attrValue: string): string[] {
  const out: string[] = [];
  // Match the full tag containing property="og:image" (either attr order).
  const tagRe = new RegExp(`<meta[^>]*${attrName}=["']${attrValue}["'][^>]*>`, 'gi');
  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = tagRe.exec(html)) !== null) {
    const contentMatch = /\bcontent=["']([^"']+)["']/i.exec(tagMatch[0]);
    if (contentMatch?.[1]) out.push(contentMatch[1]);
  }
  return out;
}

/**
 * Parse `<img>` image URLs out of raw HTML.
 *
 * Prefers `data-image` (Squarespace's full-resolution original) over
 * `data-src` over `src`. Skips images whose width/height attributes declare
 * them smaller than 200px (icons, spacers).
 */
export function extractImgSrcsFromHtml(html: string): string[] {
  const out: string[] = [];
  const imgRe = /<img\b[^>]*>/gi;
  let imgMatch: RegExpExecArray | null;
  while ((imgMatch = imgRe.exec(html)) !== null) {
    const tag = imgMatch[0];
    const attr = (name: string): string | null => {
      const m = new RegExp(`\\b${name}=["']([^"']+)["']`, 'i').exec(tag);
      return m?.[1] ?? null;
    };
    const width = parseInt(attr('width') ?? '', 10);
    const height = parseInt(attr('height') ?? '', 10);
    if (
      Number.isFinite(width) &&
      Number.isFinite(height) &&
      width > 0 &&
      height > 0 &&
      (width < 200 || height < 200)
    ) {
      continue;
    }
    const src = attr('data-image') ?? attr('data-src') ?? attr('src');
    if (src) out.push(src);
  }
  return out;
}

const GALLERY_SECTION_MARKER = /galler|photo|picture|album/i;

function findContainerEnd(html: string, contentStart: number, tagName: string): number {
  const tagRe = new RegExp(`<\\/?${tagName}\\b[^>]*>`, 'gi');
  tagRe.lastIndex = contentStart;
  let depth = 1;
  let tagMatch: RegExpExecArray | null;

  while ((tagMatch = tagRe.exec(html)) !== null) {
    if (tagMatch[0].startsWith('</')) depth -= 1;
    else if (!/\/\s*>$/.test(tagMatch[0])) depth += 1;
    if (depth === 0) return tagMatch.index + tagMatch[0].length;
  }
  return html.length;
}

/**
 * Extract image tags from containers that identify themselves as a gallery or
 * photo section. These candidates are intentionally kept ahead of generic
 * page images and social metadata, which often point at a brand logo.
 */
export function extractGalleryPhotosFromHtml(
  html: string,
  baseUrl: string,
  limit: number = MAX_PHOTOS,
): string[] {
  const candidates: string[] = [];
  const containerRe = /<(section|div|ul|ol|main|article)\b[^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = containerRe.exec(html)) !== null) {
    if (!GALLERY_SECTION_MARKER.test(match[0])) continue;
    const tagName = match[1] ?? 'div';
    const blockEnd = findContainerEnd(html, match.index + match[0].length, tagName);
    const block = html.slice(match.index, blockEnd);
    candidates.push(
      ...extractImgSrcsFromHtml(block)
        .map((src) => resolvePhotoUrl(src, baseUrl))
        .filter((url): url is string => !!url),
    );
    if (candidates.length >= limit) break;
  }

  return dedupePhotoUrls(candidates, limit);
}

/**
 * Parse OpenGraph/Twitter/JSON-LD image URLs out of raw HTML.
 * Pure function — unit-testable and reused by the fetch path.
 */
export function parseOpenGraphFromHtml(html: string, baseUrl: string): string[] {
  const candidates: string[] = [];

  // OpenGraph (og:image, og:image:secure_url, og:image:url)
  for (const prop of ['og:image:secure_url', 'og:image:url', 'og:image']) {
    candidates.push(...extractMetaContent(html, 'property', prop));
  }
  // Twitter cards (property or name attribute)
  for (const name of ['twitter:image:src', 'twitter:image']) {
    candidates.push(...extractMetaContent(html, 'name', name));
    candidates.push(...extractMetaContent(html, 'property', name));
  }
  // Classic image_src link tag
  const linkRe = /<link[^>]*rel=["']image_src["'][^>]*>/gi;
  let linkMatch: RegExpExecArray | null;
  while ((linkMatch = linkRe.exec(html)) !== null) {
    const hrefMatch = /\bhref=["']([^"']+)["']/i.exec(linkMatch[0]);
    if (hrefMatch?.[1]) candidates.push(hrefMatch[1]);
  }
  // JSON-LD "image": "url" or "image": ["url", …]
  const jsonLdRe = /"image"\s*:\s*(\[[^\]]*\]|"[^"]+")/gi;
  let jsonMatch: RegExpExecArray | null;
  while ((jsonMatch = jsonLdRe.exec(html)) !== null) {
    const value = jsonMatch[1] ?? '';
    const urlRe = /"([^"]+)"/g;
    let urlMatch: RegExpExecArray | null;
    while ((urlMatch = urlRe.exec(value)) !== null) {
      if (urlMatch[1]) candidates.push(urlMatch[1]);
    }
  }

  return dedupePhotoUrls(candidates.map((src) => resolvePhotoUrl(src, baseUrl)));
}

/** All photo candidates (metadata + <img> tags) from one page's HTML. */
export function extractPagePhotos(html: string, baseUrl: string): string[] {
  const gallery = extractGalleryPhotosFromHtml(html, baseUrl);
  if (gallery.length > 0) return rankPhotoUrls(gallery);

  const imgs = dedupePhotoUrls(
    extractImgSrcsFromHtml(html).map((src) => resolvePhotoUrl(src, baseUrl)),
    Number.MAX_SAFE_INTEGER,
  );
  const meta = parseOpenGraphFromHtml(html, baseUrl);
  return dedupePhotoUrls(
    [...rankPhotoUrls(gallery), ...rankPhotoUrls(imgs), ...rankPhotoUrls(meta)],
    Number.MAX_SAFE_INTEGER,
  );
}

/**
 * Let the event loop service pending work (renders, touches, timers).
 *
 * `setTimeout(0)` is deliberately used over a microtask: a microtask resolves
 * before React Native's task queue drains, so a chain of microtasks would block
 * exactly like a synchronous loop.
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Same result as {@link extractPagePhotos}, but never occupies the JS thread
 * for longer than {@link PARSE_SLICE_BUDGET_MS} at a time.
 *
 * Parsing HTML was the one part of the place card that genuinely blocked the
 * UI: the whole document was scanned several times in one synchronous call on
 * Hermes, so touches, renders and animations queued behind it for hundreds of
 * milliseconds. Here the document is walked in slices with a small overlap (so
 * a tag split across a boundary is still matched), and control returns to the
 * event loop between slices.
 */
export async function extractPagePhotosAsync(
  html: string,
  baseUrl: string,
  options: { sliceBytes?: number; budgetMs?: number } = {},
): Promise<string[]> {
  const sliceBytes = options.sliceBytes ?? PARSE_SLICE_BYTES;
  const budgetMs = options.budgetMs ?? PARSE_SLICE_BUDGET_MS;
  const document = html.length > MAX_PARSE_BYTES ? html.slice(0, MAX_PARSE_BYTES) : html;

  const gallery: string[] = [];
  const imgs: string[] = [];
  const meta: string[] = [];
  let start = 0;
  let lastYield = Date.now();

  while (start < document.length) {
    const sliceEnd = Math.min(document.length, start + sliceBytes);
    const windowEnd = Math.min(document.length, sliceEnd + PARSE_SLICE_OVERLAP);
    const slice = document.slice(start, windowEnd);

    gallery.push(...extractGalleryPhotosFromHtml(slice, baseUrl, Number.MAX_SAFE_INTEGER));
    imgs.push(
      ...extractImgSrcsFromHtml(slice)
        .map((src) => resolvePhotoUrl(src, baseUrl))
        .filter((url): url is string => !!url),
    );
    meta.push(...parseOpenGraphFromHtml(slice, baseUrl));

    start = sliceEnd;
    if (start < document.length && Date.now() - lastYield >= budgetMs) {
      await yieldToEventLoop();
      lastYield = Date.now();
    }
  }

  const galleryUrls = dedupePhotoUrls(gallery);
  if (galleryUrls.length > 0) return rankPhotoUrls(galleryUrls);

  return dedupePhotoUrls([...rankPhotoUrls(imgs), ...rankPhotoUrls(meta)]);
}

interface FetchedPage {
  html: string;
  /**
   * The URL the response finally came from, after any redirects (`res.url`).
   * Falls back to the requested URL when the runtime omits it. Relative image
   * paths and same-origin gallery links must resolve against this, not the
   * tagged URL, so a cross-host redirect (e.g. an old domain pointing at the
   * venue's new one) still yields the venue's photos.
   */
  finalUrl: string;
}

async function fetchPageHtmlResult(url: string, timeoutMs: number): Promise<FetchedPage | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'text/html', 'User-Agent': USER_AGENT },
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') ?? '';
    if (contentType && !/html/i.test(contentType)) return null;
    // Cap parse work on huge pages. The same budget bounds the sliced parser.
    const html = (await res.text()).slice(0, MAX_PARSE_BYTES);
    const finalUrl = normalizeWebsiteUrl((res as { url?: string }).url ?? url) ?? url;
    return { html, finalUrl };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function countRealPhotos(urls: string[]): number {
  return urls.filter((u) => !isLogoLikeUrl(u)).length;
}

/**
 * Fetch + parse ONE page into photo candidates.
 *
 * This used to fan out: the homepage, then up to three gallery subpages, for up
 * to four host candidates — up to sixteen requests, each parsed on the JS
 * thread, all of it triggered by opening a place card. The fan-out bought very
 * little (the homepage itself carries the gallery on the sites this runs into)
 * and cost seconds of CPU and network. One bounded request is the whole
 * contract now; recall beyond it is not worth blocking the card for.
 *
 * Returns `null` when the page could not be fetched (network/TLS/DNS refusal)
 * so the caller can try a sibling host.
 */
async function fetchSitePhotos(
  pageUrl: string,
  timeoutMs: number,
): Promise<{ urls: string[]; finalUrl: string } | null> {
  const page = await fetchPageHtmlResult(pageUrl, timeoutMs);
  if (!page) return null;
  // Resolve against the post-redirect URL so a site that moved to a new host
  // still contributes its own (relative) images.
  const urls = await extractPagePhotosAsync(page.html, page.finalUrl);
  return { urls, finalUrl: page.finalUrl };
}

export interface WebsitePhotosResult {
  /** Discovered photo URLs (may be empty when the site genuinely has none). */
  urls: string[];
  /**
   * True when at least one candidate page was fetched successfully. Lets callers
   * tell "this site has no photos" from "we could not reach the site" and avoid
   * caching a transient failure as a permanent empty result.
   */
  ok: boolean;
  /**
   * The URL the fetched page finally resolved to after redirects, when known.
   * Lets callers follow a website tag that has moved to a new host (and update
   * the OSM listing / drive the WebView fallback from the new origin).
   */
  finalUrl: string | null;
}

/**
 * Compare two URLs by "site host": lowercased hostname with a leading `www.`
 * (and a trailing dot) stripped, so apex and `www` count as the same site.
 */
export function siteHost(url: string): string | null {
  try {
    return new URL(url).hostname
      .toLowerCase()
      .replace(/\.$/, '')
      .replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * True when `finalUrl` resolved to a different site than `taggedUrl` — i.e. the
 * tagged URL cross-host redirected to a new domain (apex/`www` moves count as
 * the same site).
 */
export function isCrossHostRedirect(taggedUrl: string, finalUrl: string): boolean {
  const from = siteHost(taggedUrl);
  const to = siteHost(finalUrl);
  return !!from && !!to && from !== to;
}

/** True when the URL is a bare site root (`/` or empty path). */
export function isSiteRoot(url: string): boolean {
  try {
    const path = new URL(url).pathname;
    return path === '' || path === '/';
  } catch {
    return false;
  }
}

/**
 * How many host candidates one scrape may try.
 *
 * `photoPageCandidates` lists the tagged URL plus its `www.`/apex siblings over
 * https and http, which is what rescues a venue whose tag points at a broken
 * apex certificate. Trying all of them made a single place open capable of
 * four sequential 8 s fetches. Two is enough for the common `www.`/apex split;
 * the rest is not worth holding the card's data hostage for.
 */
const MAX_SCRAPE_CANDIDATES = 2;

/**
 * Fetch path: try the website tag and one `www.`/apex sibling, parsing gallery
 * sections, `<img>` tags and metadata from that ONE page. Returns on the first
 * candidate that yields a real photo. `ok` is false only when every candidate
 * failed to fetch.
 */
export async function fetchWebsitePhotosResult(
  pageUrl: string,
  timeoutMs = 8000,
): Promise<WebsitePhotosResult> {
  const cached = getCached(pageUrl);
  if (cached) return { urls: cached, ok: true, finalUrl: null };

  const candidates = photoPageCandidates(pageUrl).slice(0, MAX_SCRAPE_CANDIDATES);
  if (candidates.length === 0) return { urls: [], ok: false, finalUrl: null };

  let best: string[] | null = null;
  let bestFinalUrl: string | null = null;
  let fetchedAny = false;
  for (const candidate of candidates) {
    const page = await fetchSitePhotos(candidate, timeoutMs);
    if (page === null) continue;
    fetchedAny = true;
    if (best === null) {
      best = page.urls;
      bestFinalUrl = page.finalUrl;
    }
    if (countRealPhotos(page.urls) > 0) {
      best = page.urls;
      bestFinalUrl = page.finalUrl;
      break;
    }
  }

  const final = dedupePhotoUrls(rankPhotoUrls(best ?? []));
  // Negative-cache a successful-but-photoless scrape; never cache a total
  // failure, so a transient outage retries on the next open.
  if (fetchedAny) setCached(pageUrl, final);
  return { urls: final, ok: fetchedAny, finalUrl: bestFinalUrl };
}

/**
 * Fetch path: GET the venue page HTML and parse gallery sections, metadata and
 * `<img>` tags from it, in slices that yield to the event loop. Returns [] on
 * any failure.
 */
export async function fetchWebsitePhotos(pageUrl: string, timeoutMs = 8000): Promise<string[]> {
  const { urls } = await fetchWebsitePhotosResult(pageUrl, timeoutMs);
  return urls;
}
