/**
 * Parse a natural language search query into structured intent signals.
 *
 * Extracts modifiers ("near me", "open now", "best"), brand names,
 * cuisine hints, and the cleaned-up core query for text matching.
 */

import { resolveSearchCategories, extractCuisineHint } from '../poi/categoryResolver';
import type { PlaceCategory } from '../../models/poi';

// ---------------------------------------------------------------------------
// Known brand names (maps to what users might type → canonical brand name)
// ---------------------------------------------------------------------------
const BRAND_ALIASES: Record<string, string> = {
  // Coffee
  starbucks: 'Starbucks',
  dunkin: "Dunkin'",
  "dunkin'": "Dunkin'",
  'dunkin donuts': "Dunkin'",
  'tim hortons': 'Tim Hortons',
  peets: "Peet's Coffee",
  "peet's": "Peet's Coffee",

  // Fast food
  mcdonalds: "McDonald's",
  "mcdonald's": "McDonald's",
  'burger king': 'Burger King',
  wendys: "Wendy's",
  "wendy's": "Wendy's",
  'taco bell': 'Taco Bell',
  'chick-fil-a': 'Chick-fil-A',
  'chick fil a': 'Chick-fil-A',
  chickfila: 'Chick-fil-A',
  chipotle: 'Chipotle',
  subway: 'Subway',
  'five guys': 'Five Guys',
  'in-n-out': 'In-N-Out Burger',
  'in n out': 'In-N-Out Burger',
  popeyes: 'Popeyes',
  "popeye's": 'Popeyes',
  kfc: 'KFC',
  'papa johns': "Papa John's",
  "papa john's": "Papa John's",
  dominos: "Domino's",
  "domino's": "Domino's",
  'pizza hut': 'Pizza Hut',
  'little caesars': 'Little Caesars',
  panera: 'Panera Bread',
  'panera bread': 'Panera Bread',

  // Grocery / retail
  walmart: 'Walmart',
  target: 'Target',
  costco: 'Costco',
  'whole foods': 'Whole Foods Market',
  'trader joes': "Trader Joe's",
  "trader joe's": "Trader Joe's",
  aldi: 'ALDI',
  kroger: 'Kroger',
  safeway: 'Safeway',
  publix: 'Publix',
  'h-e-b': 'H-E-B',
  heb: 'H-E-B',
  'home depot': 'The Home Depot',
  lowes: "Lowe's",
  "lowe's": "Lowe's",
  ikea: 'IKEA',
  'best buy': 'Best Buy',
  walgreens: 'Walgreens',
  cvs: 'CVS',
  kohls: "Kohl's",
  "kohl's": "Kohl's",
  'kohl\u2019s': "Kohl's",
  marshalls: 'Marshalls',
  "marshall's": 'Marshalls',
  'marshall\u2019s': 'Marshalls',

  // Gas
  shell: 'Shell',
  bp: 'BP',
  exxon: 'Exxon',
  mobil: 'Mobil',
  chevron: 'Chevron',
  wawa: 'Wawa',

  // Hotels
  marriott: 'Marriott',
  hilton: 'Hilton',
  'holiday inn': 'Holiday Inn',
  'hampton inn': 'Hampton Inn',

  // Banks
  chase: 'Chase',
  'bank of america': 'Bank of America',
  'wells fargo': 'Wells Fargo',
  'td bank': 'TD Bank',
  'capital one': 'Capital One',

  // Other
  usps: 'USPS',
  ups: 'UPS',
  fedex: 'FedEx',
  'planet fitness': 'Planet Fitness',
  'la fitness': 'LA Fitness',
  'anytime fitness': 'Anytime Fitness',
  '7-eleven': '7-Eleven',
  '7 eleven': '7-Eleven',
};

// Sorted by length descending so multi-word brands match first
const SORTED_BRAND_KEYS = Object.keys(BRAND_ALIASES).sort((a, b) => b.length - a.length);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface BrandMatch {
  /** The alias key as it appeared in the normalized query. */
  key: string;
  /** Canonical brand name. */
  brand: string;
  /** Whole-word matcher for the key, so "mobil" cannot match "mobile". */
  matcher: RegExp;
}

/**
 * Whole-word match on the normalized query.
 *
 * A substring test is not good enough: it turns "mobile phone repair" into the
 * Mobil gas brand (and "upscale bar" into UPS), which then routes the whole
 * search through the brand path — brand-biased text scoring, a widened fetch
 * radius and branch ordering. "upscale" and "mobile" are unrelated words.
 *
 * Matchers are built once: `parseSearchQuery` runs on every keystroke.
 */
const BRAND_MATCHERS: BrandMatch[] = SORTED_BRAND_KEYS.map((key) => ({
  key,
  brand: BRAND_ALIASES[key],
  matcher: new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(key)}(?=$|[^\\p{L}\\p{N}])`, 'iu'),
}));

function findBrandMatch(normalized: string): BrandMatch | null {
  if (!normalized) return null;
  return BRAND_MATCHERS.find((candidate) => candidate.matcher.test(normalized)) ?? null;
}

// ---------------------------------------------------------------------------
// Modifier patterns
// ---------------------------------------------------------------------------
const NEAR_ME_PATTERNS = /\b(near\s*me|nearby|closest|nearest|around\s*here)\b/i;
const OPEN_NOW_PATTERNS = /\b(open\s*now|open\s*late|24\s*h(?:ou)?r|still\s*open)\b/i;
const QUALITY_PATTERNS = /\b(best|top\s*rated|good|popular|recommended|highest\s*rated)\b/i;
const CHEAP_PATTERNS = /\b(cheap|affordable|budget|inexpensive)\b/i;
const STRIP_WORDS =
  /\b(near\s*me|nearby|closest|nearest|around\s*here|open\s*now|open\s*late|24\s*h(?:ou)?r|still\s*open|best|top\s*rated|good|popular|recommended|highest\s*rated|cheap|affordable|budget|inexpensive|find|search|show|where\s*is|looking\s*for|i\s*want|i\s*need|the)\b/gi;

export interface ParsedSearchQuery {
  /** The core search text after stripping modifiers and brand matches. */
  coreQuery: string;
  /** Original query as-is. */
  originalQuery: string;
  /** Resolved place categories, or null if not a category search. */
  categories: PlaceCategory[] | null;
  /** Extracted cuisine hint (e.g. "pizza", "chinese"). */
  cuisineHint: string | null;
  /** Matched brand name, or null. */
  brand: string | null;
  /** User wants results near current location. */
  wantsNearMe: boolean;
  /** User wants places that are open now. */
  wantsOpenNow: boolean;
  /** User wants top-rated / popular results. */
  wantsQuality: boolean;
  /** User wants budget-friendly options. */
  wantsCheap: boolean;
  /** Whether the query is purely a name/brand search (not category). */
  isNameSearch: boolean;
}

export function normalizeSearchText(text: string): string {
  return (
    text
      .normalize('NFKD')
      // Strip combining diacritical marks so "café" matches "cafe".
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[\u2018\u2019\u0060\u00B4]/g, "'")
      .replace(/[\u2010-\u2015]/g, '-')
      // Remove punctuation except ' & - so "coffee-grind" and "coffee grind" match.
      .replace(/[^\p{L}\p{N}'&\- ]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/** Category-word synonyms so name matching understands intent
 *  (e.g. query "coffee" matches subtype "cafe" and vice versa). */
const CATEGORY_SYNONYMS: Record<string, string[]> = {
  coffee: ['coffee', 'cafe', 'espresso', 'cappuccino', 'latte'],
  cafe: ['cafe', 'coffee', 'tea', 'espresso'],
  pizza: ['pizza', 'pizzeria', 'italian'],
  burger: ['burger', 'burgers', 'fast_food'],
  bar: ['bar', 'pub', 'brewery', 'cocktail'],
  gas: ['gas', 'fuel', 'petrol', 'gasoline'],
};

/** Expand a single query token into its synonym set (includes itself). */
export function expandTokenSynonyms(token: string): string[] {
  const lower = token.toLowerCase();
  return CATEGORY_SYNONYMS[lower] ?? [lower];
}

/**
 * Parse a user search query into structured intent.
 */
export function parseSearchQuery(query: string): ParsedSearchQuery {
  const originalQuery = query.trim();
  const canonicalQuery = normalizeSearchText(originalQuery);
  const normalized = canonicalQuery.toLowerCase();

  // 1. Brand first: modifier words inside a brand name are not intent
  // ("best buy" is the store, not a request for top-rated places).
  const brandMatch = findBrandMatch(normalized);
  const brand = brandMatch?.brand ?? null;

  // 2. Extract modifiers from the query with the brand removed, so
  // "best buy coffee" still doesn't read as "best".
  const modifierText = brandMatch ? normalized.replace(brandMatch.matcher, ' ') : normalized;
  const wantsNearMe = NEAR_ME_PATTERNS.test(modifierText);
  const wantsOpenNow = OPEN_NOW_PATTERNS.test(modifierText);
  const wantsQuality = QUALITY_PATTERNS.test(modifierText);
  const wantsCheap = CHEAP_PATTERNS.test(modifierText);

  // 3. Resolve categories from the original query
  const categories = resolveSearchCategories(canonicalQuery);

  // 4. Extract cuisine hint
  const cuisineHint = extractCuisineHint(canonicalQuery);

  // 5. Build core query by stripping modifiers
  let coreQuery = canonicalQuery.replace(STRIP_WORDS, '').replace(/\s+/g, ' ').trim();
  if (!coreQuery) coreQuery = originalQuery.trim();

  // 6. Determine if this is a name-based search
  // Treat almost every free-text query as a name search too — single-word
  // category queries like "coffee" or "pizza" are ALSO place names
  // ("The Coffee Grind", "Pizza Palace"). This broadens Photon fetch,
  // enables name + category hybrid scoring, and keeps results thorough.
  // Address handling is gated separately by isAddressQuery, so this is safe.
  const isNameSearch = brand !== null || coreQuery.length >= 2;

  return {
    coreQuery,
    originalQuery,
    categories,
    cuisineHint,
    brand,
    wantsNearMe,
    wantsOpenNow,
    wantsQuality,
    wantsCheap,
    isNameSearch,
  };
}

// ---------------------------------------------------------------------------
// Address heuristic
// ---------------------------------------------------------------------------

/**
 * Street-type abbreviations as whole tokens. Unambiguous as address evidence —
 * but only after the first word: "St Louis", "Ave Maria" and "Dr King" start
 * with an honorific or a name, not with a street type.
 */
const ADDRESS_ABBREV_RE = /\b(st|ave|blvd|rd|dr|ln|ct|pl|pkwy|pky|hwy|cir|ter|trl|aly|cv|sq)\b/i;

/**
 * Full street-type words. These are everyday nouns too — "pizza place",
 * "tennis court", "the loop", "drive in movie" — so on their own they are not
 * address evidence; they only count alongside a house number or a numeric
 * route ("Country Road 5", "Highway 101").
 */
const ADDRESS_FULLWORD_RE =
  /\b(street|avenue|boulevard|road|drive|lane|court|place|highway|parkway|circle|terrace|trail|alley|cove|square|way|loop|path|walk|pass)\b/i;

/** Starts with a house number (digits, optionally followed by a letter like "314A"). */
const LEADING_NUMBER_RE = /^\s*\d+[a-z]?[\s,]/i;

/**
 * Leading house number + word ending with an embedded street suffix.
 * Catches queries like "1000 Broadway" or "1 Gateway" where "way" is
 * not a standalone token but appears at the end of a street-name word.
 * Only triggered when the query starts with a house number, to avoid
 * false positives on generic words like "doorway" or "hallway".
 */
const LEADING_NUMBER_WITH_SUFFIX_RE =
  /^\d+[a-z]?\s.*\b\w+(?:way|circle|terrace|trail|alley|cove|square|path|walk|loop|pass)\b/i;

/**
 * Returns true if the query looks like a street address.
 * Used to boost geocoding results above POI results, and to restrict
 * Photon results to house + street layers.
 */
export function isAddressQuery(query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) return false;

  const hasStreetToken = ADDRESS_ABBREV_RE.test(trimmed) || ADDRESS_FULLWORD_RE.test(trimmed);
  const leadingHouseNumber = LEADING_NUMBER_RE.test(trimmed);

  // "314 columbus pkwy", "123 main street" — a house number plus any street token.
  if (leadingHouseNumber && (trimmed.includes(',') || hasStreetToken)) return true;
  // "Country Road 5", "Route 66 Highway", "Highway 101" — numbered routes.
  if (/\d/.test(trimmed) && hasStreetToken) return true;
  // "main st", "union sq" — abbreviations are street types anywhere but first.
  const afterFirstWord = trimmed.replace(/^\s*\S+\s*/, '');
  if (ADDRESS_ABBREV_RE.test(afterFirstWord)) return true;
  // "1000 Broadway" — leading house number + word ending with an embedded suffix.
  if (LEADING_NUMBER_WITH_SUFFIX_RE.test(trimmed)) return true;
  return false;
}

/**
 * Compute a Levenshtein edit distance between two strings.
 * Used for fuzzy matching — e.g. "starbuks" vs "Starbucks".
 */
export function levenshtein(a: string, b: string): number {
  const la = a.length;
  const lb = b.length;
  if (la === 0) return lb;
  if (lb === 0) return la;

  // Single-row DP
  let prev = new Array<number>(lb + 1);
  let curr = new Array<number>(lb + 1);

  for (let j = 0; j <= lb; j++) prev[j] = j;

  for (let i = 1; i <= la; i++) {
    curr[0] = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }

  return prev[lb];
}

/**
 * Check if a query fuzzy-matches a brand name (within edit distance threshold).
 * Returns the matched brand or null.
 */
export function fuzzyMatchBrand(query: string): string | null {
  const normalized = query.toLowerCase().trim();
  // Exact (whole-word) check first — already done in parseSearchQuery, but useful standalone
  const exact = findBrandMatch(normalized);
  if (exact) return exact.brand;

  // Typo tolerance only makes sense for a single token: comparing a whole
  // multi-word query against a brand by edit distance matches almost anything.
  const words = normalized.split(/\s+/);
  if (words.length !== 1) return null;

  for (const key of SORTED_BRAND_KEYS) {
    if (key.includes(' ')) continue; // phrase brands only match exactly
    const maxDist = key.length <= 4 ? 1 : key.length <= 8 ? 2 : 3;
    const dist = levenshtein(normalized, key);
    if (dist <= maxDist && dist > 0) return BRAND_ALIASES[key];
  }
  return null;
}
