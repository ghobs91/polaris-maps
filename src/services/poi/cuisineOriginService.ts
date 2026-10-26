/**
 * Cuisine-origin labels from a venue's "About us" / "Our story" page.
 *
 * Many restaurants describe themselves only as "Mediterranean"; the specific
 * country or region is often spelled out on the about/story page instead. This
 * service fetches that page on-device, extracts visible copy, and matches it
 * against a curated lexicon of country names, demonyms, cities, and dishes.
 *
 * Detection order:
 *  1. Fetch the venue homepage (no JS execution).
 *  2. If the homepage is itself an about/story page, analyze it directly.
 *  3. Otherwise follow "about us" / "our story" style links (max 3 pages),
 *     then try common about-page paths.
 *  4. Fall back to the homepage copy only when no about page was found.
 *
 * Matching is deliberately conservative: a label requires at least one strong
 * signal (country name or demonym) or a city plus a dish, so a passing mention
 * of a city in a footer never produces a pill. Only http(s) URLs are loaded and
 * results are cached in memory.
 *
 * A future LLM-backed analyzer can replace `detectCuisineOrigins` inside
 * `fetchCuisineOrigins` without changing the fetch/caching/UI contract.
 */

import { fetchWebsiteHtml } from './websiteHtmlService';

export interface CuisineOrigin {
  /** ISO 3166-1 alpha-2 country code. */
  countryCode: string;
  /** Short label shown in the pill, e.g. "Israeli". */
  label: string;
  /** Flag emoji derived from the country code, e.g. "🇮🇱". */
  flag: string;
  /** Internal confidence score (higher = more distinct evidence). */
  score: number;
  /** Matched signals, useful for tests and debugging. */
  evidence: string[];
}

interface CuisineOriginDefinition {
  countryCode: string;
  label: string;
  /** Country names and demonyms — enough on their own. */
  strong: RegExp[];
  /** Cities/regions — meaningful but weaker than a country mention. */
  medium?: RegExp[];
  /** Characteristic dishes — only a tiebreaker. */
  weak?: RegExp[];
}

const STRONG_SCORE = 3;
const MEDIUM_SCORE = 2;
const WEAK_SCORE = 1;
/** Minimum score before a label is shown (one strong signal, or city + dish). */
const MIN_SCORE = 3;
/** Cap so the header never fills with a wall of flags. */
const MAX_RESULTS = 2;
const MAX_ABOUT_PAGES = 3;
const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 100;

/**
 * OSM/MapKit subtypes where a cuisine-origin label makes sense. Keeps the
 * scrape off hotels, shops, and other venues that merely have an about page.
 */
const FOOD_VENUE_SUBTYPES = new Set([
  'restaurant',
  'cafe',
  'coffee_shop',
  'fast_food',
  'food_court',
  'bar',
  'pub',
  'deli',
  'bakery',
  'ice_cream',
]);

/** True when a POI subtype is a food venue worth labeling. */
export function isFoodVenue(subtype: string | null | undefined): boolean {
  if (!subtype) return false;
  return FOOD_VENUE_SUBTYPES.has(subtype.trim().toLowerCase());
}

/**
 * Curated lexicon. Kept intentionally compact for the Mediterranean / Middle
 * East, where "Mediterranean" is the most common ambiguous label, plus a few
 * other cuisines that appear in the same directories.
 *
 * Shared pan-Levantine staples (hummus, falafel, tabbouleh) are deliberately
 * absent: they would match several countries at once and add noise, not signal.
 */
const DEFINITIONS: CuisineOriginDefinition[] = [
  {
    countryCode: 'IL',
    label: 'Israeli',
    strong: [/\bisraeli\b/, /\bisrael\b/],
    medium: [/\btel aviv\b/, /\bjerusalem\b/, /\bhaifa\b/, /\bjaffa\b/, /\bgalilee\b/],
    weak: [/\bshakshuka\b/, /\bsabich\b/, /\bknafeh\b/, /\bjachnun\b/],
  },
  {
    countryCode: 'LB',
    label: 'Lebanese',
    strong: [/\blebanese\b/, /\blebanon\b/],
    medium: [/\bbeirut\b/, /\bbyblos\b/, /\bzahl[ae]\b/],
    weak: [/\bkibbeh\b/, /\bmanakish\b/, /\bmuhammara\b/, /\bfattoush\b/],
  },
  {
    countryCode: 'EG',
    label: 'Egyptian',
    strong: [/\begyptian\b/, /\begypt\b/],
    medium: [/\bcairo\b/, /\balexandria\b/, /\bluxor\b/],
    weak: [/\bkoshari\b/, /\bmolokhia\b/, /\bful medames\b/, /\bhawawshi\b/],
  },
  {
    countryCode: 'SY',
    label: 'Syrian',
    strong: [/\bsyrian\b/, /\bsyria\b/],
    medium: [/\bdamascus\b/, /\baleppo\b/, /\bhoms\b/],
    weak: [/\bmuhammara\b/, /\bkibbeh\b/, /\bshish tawook\b/],
  },
  {
    countryCode: 'JO',
    label: 'Jordanian',
    strong: [/\bjordanian\b/],
    medium: [/\bamman\b/, /\bpetra\b/, /\birbid\b/],
    weak: [/\bmansaf\b/, /\bmaqluba\b/],
  },
  {
    countryCode: 'PS',
    label: 'Palestinian',
    strong: [/\bpalestinian\b/, /\bpalestine\b/],
    medium: [/\bbethlehem\b/, /\bramallah\b/, /\bnablus\b/, /\bgaza\b/],
    weak: [/\bmaqluba\b/, /\bmsakhan\b/, /\bqidra\b/],
  },
  {
    countryCode: 'TR',
    label: 'Turkish',
    strong: [/\bturkish\b/, /\bturkiye\b/],
    medium: [/\bistanbul\b/, /\bankara\b/, /\bizmir\b/, /\bgaziantep\b/],
    weak: [/\bmanti\b/, /\blahmacun\b/, /\bbaklava\b/, /\bkebab\b/],
  },
  {
    countryCode: 'GR',
    label: 'Greek',
    strong: [/\bgreek\b/, /\bgreece\b/],
    medium: [/\bathens\b/, /\bthessaloniki\b/, /\bcrete\b/, /\bsantorini\b/],
    weak: [/\bmoussaka\b/, /\bsouvlaki\b/, /\bspanakopita\b/, /\bpastitsio\b/],
  },
  {
    countryCode: 'CY',
    label: 'Cypriot',
    strong: [/\bcypriot\b/, /\bcyprus\b/],
    medium: [/\bnicosia\b/, /\blimassol\b/, /\bpaphos\b/],
    weak: [/\bhalloumi\b/, /\bsouvlaki\b/],
  },
  {
    countryCode: 'AR',
    label: 'Armenian',
    strong: [/\barmenian\b/, /\barmenia\b/],
    medium: [/\byerevan\b/],
    weak: [/\blahmajoun\b/],
  },
  {
    countryCode: 'IR',
    label: 'Persian',
    strong: [/\bpersian\b/, /\biranian\b/, /\biran\b/],
    medium: [/\btehran\b/, /\bshiraz\b/, /\bisfahan\b/],
    weak: [/\bghormeh sabzi\b/, /\bfesenjan\b/, /\btahdig\b/],
  },
  {
    countryCode: 'IT',
    label: 'Italian',
    strong: [/\bitalian\b/, /\bitaly\b/],
    medium: [/\brome\b/, /\bnaples\b/, /\bsicily\b/, /\btuscany\b/, /\bbologna\b/],
    weak: [/\bcacio e pepe\b/, /\bosso buco\b/, /\bragu\b/, /\bgnocchi\b/],
  },
  {
    countryCode: 'FR',
    label: 'French',
    strong: [/\bfrench\b/, /\bfrance\b/],
    medium: [/\bparis\b/, /\blyon\b/, /\bprovence\b/, /\bbordeaux\b/],
    weak: [/\bcoq au vin\b/, /\bbouillabaisse\b/, /\bconfit\b/],
  },
  {
    countryCode: 'ES',
    label: 'Spanish',
    strong: [/\bspanish\b/, /\bspain\b/],
    medium: [/\bmadrid\b/, /\bbarcelona\b/, /\bseville\b/, /\bvalencia\b/],
    weak: [/\bpaella\b/, /\btapas\b/, /\bgazpacho\b/],
  },
  {
    countryCode: 'MA',
    label: 'Moroccan',
    strong: [/\bmoroccan\b/, /\bmorocco\b/],
    medium: [/\bmarrakesh\b/, /\bcasablanca\b/, /\bfez\b/],
    weak: [/\btagine\b/, /\bcouscous\b/, /\bharira\b/],
  },
];

/**
 * Phrases where a demonym refers to something other than a cuisine. Removed
 * before matching so "French fries" never becomes a French label.
 */
const FALSE_POSITIVE_PHRASES = [
  /\bfrench fries\b/g,
  /\bfrench toast\b/g,
  /\bfrench dressing\b/g,
  /\bfrench onion soup\b/g,
  /\bitalian dressing\b/g,
  /\bspanish rice\b/g,
];

/** Convert an ISO 3166-1 alpha-2 code to its flag emoji. */
export function flagEmoji(countryCode: string): string {
  const code = countryCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return '';
  const base = 0x1f1e6;
  const first = code.charCodeAt(0) - 65;
  const second = code.charCodeAt(1) - 65;
  return String.fromCodePoint(base + first, base + second);
}

const ENTITY_MAP: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&mdash;': '—',
  '&ndash;': '–',
  '&hellip;': '…',
  '&rsquo;': '’',
  '&lsquo;': '‘',
  '&ldquo;': '“',
  '&rdquo;': '”',
};

function decodeEntities(text: string): string {
  return text
    .replace(/&[a-z]+;|&#\d+;|&#x[0-9a-f]+;/gi, (entity) => {
      const known = ENTITY_MAP[entity.toLowerCase()];
      if (known) return known;
      const numeric = /^&#x([0-9a-f]+);$/i.exec(entity);
      if (numeric) return String.fromCodePoint(parseInt(numeric[1] ?? '', 16));
      const decimal = /^&#(\d+);$/.exec(entity);
      if (decimal) return String.fromCodePoint(parseInt(decimal[1] ?? '', 10));
      return ' ';
    })
    .replace(/&nbsp;/gi, ' ');
}

/**
 * Strip an HTML document down to readable copy. Drops scripts, styles, and
 * navigation/footer chrome so boilerplate does not look like cuisine evidence.
 */
export function extractVisibleText(html: string): string {
  let text = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(nav|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr|td)>/gi, ' ')
    .replace(/<[^>]*>/g, ' ');
  text = decodeEntities(text);
  return text.replace(/\s+/g, ' ').trim();
}

const ABOUT_LINK_RE =
  /\b(about\s+us|about|our\s+story|story|who\s+we\s+are|our\s+history|history|heritage|philosophy|origins|our\s+chef|the\s+chef|family)\b/i;
const NON_ABOUT_LINK_RE =
  /\b(contact|reserv|order|menu|gallery|photos?|privacy|terms|careers?|jobs?|press|blog|events?|catering|delivery|locations?|gift)\b/i;

function resolveSameOriginUrl(href: string, baseUrl: string): string | null {
  const trimmed = href.trim();
  if (
    !trimmed ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('mailto:') ||
    trimmed.startsWith('tel:') ||
    trimmed.startsWith('javascript:')
  ) {
    return null;
  }
  try {
    const base = new URL(baseUrl);
    const url = new URL(trimmed, baseUrl);
    if (url.protocol === 'http:') url.protocol = 'https:';
    if (url.protocol !== 'https:') return null;
    if (url.hostname !== base.hostname) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Rank about/story candidates linked from a homepage. Strong "about us" /
 * "our story" anchors win over a generic "about" link; unrelated nav links are
 * ignored. Exported for unit tests.
 */
export function findAboutPageUrls(html: string, baseUrl: string): string[] {
  const scored: Array<{ url: string; score: number; order: number }> = [];
  const seen = new Set<string>();
  const anchorRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{0,160}?)<\/a>/gi;
  let match: RegExpExecArray | null;
  let order = 0;

  while ((match = anchorRe.exec(html)) !== null) {
    const url = resolveSameOriginUrl(match[1] ?? '', baseUrl);
    if (!url || seen.has(url)) continue;
    const anchor = (match[2] ?? '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    let path = '';
    try {
      path = new URL(url).pathname;
    } catch {
      continue;
    }
    const haystack = `${anchor} ${path.replace(/[-_/]+/g, ' ')}`;
    if (NON_ABOUT_LINK_RE.test(haystack)) continue;
    if (!ABOUT_LINK_RE.test(haystack)) continue;

    let score = 1;
    if (/\babout\s+us\b/i.test(anchor)) score = 3;
    else if (/\b(our\s+story|our\s+history|who\s+we\s+are)\b/i.test(anchor)) score = 3;
    else if (/\b(story|history|heritage|philosophy|origins)\b/i.test(anchor)) score = 2;

    seen.add(url);
    scored.push({ url, score, order: order++ });
  }

  return scored.sort((a, b) => b.score - a.score || a.order - b.order).map((entry) => entry.url);
}

/** Common about-page paths, used only when the homepage links none. */
const FALLBACK_ABOUT_PATHS = [
  '/about',
  '/about-us',
  '/our-story',
  '/story',
  '/aboutus',
  '/who-we-are',
];

/** True when a path itself looks like an about/story page. */
function isAboutPath(pathname: string): boolean {
  const normalized = pathname.replace(/[-_/]+/g, ' ').toLowerCase();
  return ABOUT_LINK_RE.test(normalized) && !NON_ABOUT_LINK_RE.test(normalized);
}

/** Normalize copy for matching: lowercase, punctuation → spaces. */
function normalizeForMatching(text: string): string {
  let normalized = text.toLowerCase();
  for (const phrase of FALSE_POSITIVE_PHRASES) normalized = normalized.replace(phrase, ' ');
  return normalized
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Detect cuisine origins in about-page copy. Pure function — the seam where a
 * future LLM analyzer would plug in.
 */
export function detectCuisineOrigins(text: string): CuisineOrigin[] {
  if (!text.trim()) return [];
  const haystack = normalizeForMatching(text);

  const results: Array<{ origin: CuisineOrigin; position: number }> = [];
  for (const definition of DEFINITIONS) {
    let score = 0;
    let position = Number.POSITIVE_INFINITY;
    const evidence: string[] = [];

    const record = (pattern: RegExp, points: number) => {
      const hit = pattern.exec(haystack);
      if (!hit) return;
      score += points;
      position = Math.min(position, hit.index);
      evidence.push(hit[0]);
    };

    for (const pattern of definition.strong) record(pattern, STRONG_SCORE);
    for (const pattern of definition.medium ?? []) record(pattern, MEDIUM_SCORE);
    for (const pattern of definition.weak ?? []) record(pattern, WEAK_SCORE);

    // A passing city name alone is not enough; require a country/demonym or a
    // combination of weaker signals.
    if (score < MIN_SCORE) continue;

    results.push({
      origin: {
        countryCode: definition.countryCode,
        label: definition.label,
        flag: flagEmoji(definition.countryCode),
        score,
        evidence,
      },
      position,
    });
  }

  return (
    results
      // Earlier mentions win ties, so the venue's own framing leads the list.
      .sort((a, b) => b.origin.score - a.origin.score || a.position - b.position)
      .slice(0, MAX_RESULTS)
      .map((entry) => entry.origin)
  );
}

interface CuisineOriginCacheEntry {
  origins: CuisineOrigin[];
  expiresAt: number;
}

const originCache = new Map<string, CuisineOriginCacheEntry>();

export function clearCuisineOriginCache(): void {
  originCache.clear();
}

function getCached(url: string): CuisineOrigin[] | null {
  const entry = originCache.get(url);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    originCache.delete(url);
    return null;
  }
  return entry.origins;
}

function setCached(url: string, origins: CuisineOrigin[]): CuisineOrigin[] {
  if (originCache.size >= MAX_CACHE_ENTRIES) {
    const first = originCache.keys().next().value;
    if (first !== undefined) originCache.delete(first);
  }
  originCache.set(url, { origins, expiresAt: Date.now() + CACHE_TTL_MS });
  return origins;
}

/**
 * Fetch a venue website, locate its about/story page, and return cuisine-origin
 * labels. Returns [] on any failure. Results (including misses) are cached
 * in-memory for an hour.
 */
export async function fetchCuisineOrigins(
  pageUrl: string,
  timeoutMs = 8000,
): Promise<CuisineOrigin[]> {
  const cached = getCached(pageUrl);
  if (cached) return cached;

  const homepage = await fetchWebsiteHtml(pageUrl, timeoutMs);
  if (!homepage) return setCached(pageUrl, []);

  let homepagePath = '';
  try {
    homepagePath = new URL(homepage.url).pathname;
  } catch {
    homepagePath = '';
  }

  // A site whose homepage *is* the story page needs no extra fetch.
  if (isAboutPath(homepagePath)) {
    const direct = detectCuisineOrigins(extractVisibleText(homepage.html));
    if (direct.length > 0) return setCached(pageUrl, direct);
  }

  const linked = findAboutPageUrls(homepage.html, homepage.url);
  const candidates = [...linked];
  try {
    for (const path of FALLBACK_ABOUT_PATHS) {
      if (candidates.length >= MAX_ABOUT_PAGES) break;
      const url = new URL(path, homepage.url).toString();
      if (!candidates.includes(url)) candidates.push(url);
    }
  } catch {
    // Invalid base URL — fall through with whatever links were found.
  }

  for (const candidate of candidates.slice(0, MAX_ABOUT_PAGES)) {
    const page = await fetchWebsiteHtml(candidate, timeoutMs);
    if (!page) continue;
    const origins = detectCuisineOrigins(extractVisibleText(page.html));
    if (origins.length > 0) return setCached(pageUrl, origins);
  }

  // No about page produced a label: the homepage copy itself may still name the
  // cuisine (common on single-page sites).
  const origins = detectCuisineOrigins(extractVisibleText(homepage.html));
  return setCached(pageUrl, origins);
}
