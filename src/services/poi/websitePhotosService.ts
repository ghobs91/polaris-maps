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
/** Homepage yields fewer real photos than this → crawl photo subpages. */
const MIN_REAL_PHOTOS = 3;
/** Max same-origin photo subpages (gallery/photos/…) to fetch. */
const MAX_SUBPAGES = 3;
const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 100;

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
const GALLERY_PAGE_MARKER = /galler|photo|picture|album|image/i;

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
export function extractGalleryPhotosFromHtml(html: string, baseUrl: string): string[] {
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
  }

  return dedupePhotoUrls(candidates);
}

const PHOTO_PAGE_KEYWORDS =
  /galler|photo|picture|image|menu|food|dish|interior|ambian|about|visit|tour/i;

function isDedicatedGalleryPageUrl(url: string): boolean {
  try {
    return GALLERY_PAGE_MARKER.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/**
 * Discover likely photo subpages (gallery/photos/menu/…) from same-origin
 * `<a href>` links, matching on URL path or link text. Returns absolute
 * http(s) URLs, capped at MAX_SUBPAGES, excluding the page itself.
 */
export function discoverPhotoPageUrls(html: string, baseUrl: string): string[] {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return [];
  }
  const found: string[] = [];
  const seen = new Set<string>([`${base.origin}${base.pathname}`]);
  const anchorRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null) {
    const href = (m[1] ?? '').trim();
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) {
      continue;
    }
    const text = (m[2] ?? '').replace(/<[^>]*>/g, ' ');
    let abs: URL;
    try {
      abs = new URL(href, baseUrl);
    } catch {
      continue;
    }
    if (abs.origin !== base.origin) continue;
    if (abs.protocol !== 'https:' && abs.protocol !== 'http:') continue;
    const key = `${abs.origin}${abs.pathname}`;
    if (seen.has(key)) continue;
    if (!PHOTO_PAGE_KEYWORDS.test(abs.pathname) && !PHOTO_PAGE_KEYWORDS.test(text)) continue;
    seen.add(key);
    found.push(abs.toString());
  }
  return [
    ...found.filter(isDedicatedGalleryPageUrl),
    ...found.filter((url) => !isDedicatedGalleryPageUrl(url)),
  ].slice(0, MAX_SUBPAGES);
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

async function fetchPageHtml(url: string, timeoutMs: number): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'text/html' },
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') ?? '';
    if (contentType && !/html/i.test(contentType)) return null;
    // Cap parse work on huge pages.
    return (await res.text()).slice(0, 500_000);
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
 * Fetch path: GET the homepage HTML (gallery sections, metadata, and `<img>`
 * tags); follow dedicated gallery/photo subpages when available or when the
 * homepage yields fewer than MIN_REAL_PHOTOS real photos. Returns [] on any
 * failure.
 */
export async function fetchWebsitePhotos(pageUrl: string, timeoutMs = 8000): Promise<string[]> {
  const cached = getCached(pageUrl);
  if (cached) return cached;

  const finish = (urls: string[]): string[] => {
    const final = dedupePhotoUrls(rankPhotoUrls(urls));
    setCached(pageUrl, final);
    return final;
  };

  const homeHtml = await fetchPageHtml(pageUrl, timeoutMs);
  if (!homeHtml) return [];
  const homePhotos = extractPagePhotos(homeHtml, pageUrl);
  const subpages = discoverPhotoPageUrls(homeHtml, pageUrl);
  const hasDedicatedGalleryPage = subpages.some(isDedicatedGalleryPageUrl);
  if (countRealPhotos(homePhotos) >= MIN_REAL_PHOTOS && !hasDedicatedGalleryPage) {
    return finish(homePhotos);
  }
  if (subpages.length === 0) return finish(homePhotos);

  const subHtmls = await Promise.all(subpages.map((url) => fetchPageHtml(url, 6000)));
  // Dedicated gallery pages are the strongest signal for actual place photos;
  // keep them ahead of homepage metadata such as og:image logos.
  const galleryPhotos: string[] = [];
  subHtmls.forEach((html, i) => {
    if (!html) return;
    galleryPhotos.push(...extractPagePhotos(html, subpages[i] as string));
  });
  return finish([...galleryPhotos, ...homePhotos]);
}

/**
 * Injected JS for the hidden-WebView fallback. Runs on-device after page
 * load, collects og/twitter/link/JSON-LD images, large `<img>` (preferring
 * `data-image` full-resolution originals), `<video poster>` targets, and
 * large CSS background images — then postMessages them back. Re-collects
 * after a delay so lazy-loaded galleries are captured.
 *
 * NOTE: keep this ES5-compatible (no optional chaining) — it runs inside
 * arbitrary third-party pages.
 */
export const WEBSITE_PHOTOS_JS = `(function () {
  var SENT = false;
  function pushInto(urls, v) { if (v && urls.length < 30) urls.push(v); }
  function collect() {
    var urls = [];
    var galleryNodes = document.querySelectorAll('[id*="gallery" i], [class*="gallery" i], [aria-label*="gallery" i], [id*="photo" i], [class*="photo" i], [aria-label*="photo" i]');
    for (var g = 0; g < galleryNodes.length && urls.length < 30; g++) {
      var galleryImgs = galleryNodes[g].querySelectorAll ? galleryNodes[g].querySelectorAll('img') : [];
      for (var gi = 0; gi < galleryImgs.length && urls.length < 30; gi++) {
        var galleryImg = galleryImgs[gi];
        var gw = galleryImg.naturalWidth || galleryImg.width || 0;
        var gh = galleryImg.naturalHeight || galleryImg.height || 0;
        if (gw >= 200 && gh >= 200) pushInto(urls, galleryImg.getAttribute('data-image') || galleryImg.currentSrc || galleryImg.src);
      }
    }
    // If the page has a usable gallery, don't dilute it with branding or
    // social-preview images from the rest of the page.
    if (urls.length) {
      SENT = true;
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'website-photos', urls: urls }));
      return;
    }
    var metas = document.querySelectorAll('meta[property="og:image"], meta[property="og:image:secure_url"], meta[property="og:image:url"], meta[name="twitter:image"], meta[name="twitter:image:src"], meta[property="twitter:image"]');
    for (var i = 0; i < metas.length; i++) pushInto(urls, metas[i].getAttribute('content'));
    var link = document.querySelector('link[rel="image_src"]');
    if (link) pushInto(urls, link.getAttribute('href'));
    var scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (var s = 0; s < scripts.length; s++) {
      try {
        var data = JSON.parse(scripts[s].textContent || 'null');
        var items = Array.isArray(data) ? data : [data];
        for (var k = 0; k < items.length; k++) {
          var img = items[k] && items[k].image;
          if (typeof img === 'string') pushInto(urls, img);
          else if (img && typeof img.url === 'string') pushInto(urls, img.url);
          else if (Array.isArray(img)) {
            for (var m = 0; m < img.length; m++) {
              if (typeof img[m] === 'string') pushInto(urls, img[m]);
              else if (img[m] && typeof img[m].url === 'string') pushInto(urls, img[m].url);
            }
          }
        }
      } catch (e) { /* malformed JSON-LD — ignore */ }
    }
    var imgs = document.querySelectorAll('img');
    for (var j = 0; j < imgs.length; j++) {
      var el = imgs[j];
      var w = el.naturalWidth || el.width || (el.getBoundingClientRect ? el.getBoundingClientRect().width : 0);
      var h = el.naturalHeight || el.height || (el.getBoundingClientRect ? el.getBoundingClientRect().height : 0);
      if (w >= 200 && h >= 200) {
        pushInto(urls, el.getAttribute('data-image') || el.currentSrc || el.src);
      }
    }
    var all = document.querySelectorAll('div, section, figure, a, span');
    for (var b = 0; b < all.length && urls.length < 30; b++) {
      var node = all[b];
      var rect = node.getBoundingClientRect ? node.getBoundingClientRect() : null;
      if (!rect || rect.width < 200 || rect.height < 200) continue;
      try {
        var bg = window.getComputedStyle(node).backgroundImage || '';
        var bgMatch = /url\\(["']?([^"')]+)["']?\\)/.exec(bg);
        if (bgMatch && bgMatch[1]) pushInto(urls, bgMatch[1]);
      } catch (e2) { /* cross-origin style — ignore */ }
    }
    var videos = document.querySelectorAll('video[poster]');
    for (var v = 0; v < videos.length; v++) pushInto(urls, videos[v].getAttribute('poster'));
    if (!SENT || urls.length) {
      SENT = true;
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'website-photos', urls: urls }));
    }
  }
  collect();
  setTimeout(collect, 2500);
  return true;
})();`;

/** Parse a WebView onMessage payload for website-photos results. */
export function extractPhotosFromWebViewMessage(data: string): string[] | null {
  try {
    const msg = JSON.parse(data) as { type?: string; urls?: unknown };
    if (msg.type !== 'website-photos' || !Array.isArray(msg.urls)) return null;
    return dedupePhotoUrls(msg.urls.filter((u): u is string => typeof u === 'string'));
  } catch {
    return null;
  }
}

/** Resolve + rank + dedupe raw WebView URLs against the page URL. */
export function resolveWebViewPhotoUrls(rawUrls: string[], baseUrl: string): string[] {
  return dedupePhotoUrls(
    rankPhotoUrls(
      rawUrls.map((src) => resolvePhotoUrl(src, baseUrl)).filter((u): u is string => !!u),
    ),
  );
}
