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
  return text
    .normalize('NFKD')
    .replace(/[\u2018\u2019\u0060\u00B4]/g, "'")
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse a user search query into structured intent.
 */
export function parseSearchQuery(query: string): ParsedSearchQuery {
  const originalQuery = query.trim();
  const canonicalQuery = normalizeSearchText(originalQuery);
  const normalized = canonicalQuery.toLowerCase();

  // 1. Extract modifiers
  const wantsNearMe = NEAR_ME_PATTERNS.test(normalized);
  const wantsOpenNow = OPEN_NOW_PATTERNS.test(normalized);
  const wantsQuality = QUALITY_PATTERNS.test(normalized);
  const wantsCheap = CHEAP_PATTERNS.test(normalized);

  // 2. Check for brand match
  let brand: string | null = null;
  for (const key of SORTED_BRAND_KEYS) {
    if (normalized.includes(key)) {
      brand = BRAND_ALIASES[key];
      break;
    }
  }

  // 3. Resolve categories from the original query
  const categories = resolveSearchCategories(canonicalQuery);

  // 4. Extract cuisine hint
  const cuisineHint = extractCuisineHint(canonicalQuery);

  // 5. Build core query by stripping modifiers
  let coreQuery = canonicalQuery.replace(STRIP_WORDS, '').replace(/\s+/g, ' ').trim();
  if (!coreQuery) coreQuery = originalQuery.trim();

  // 6. Determine if this is a name-based search
  // It's a name search if we found a brand OR if there are no category matches
  // and the query looks like a place name (capitalized, no obvious category words)
  const isNameSearch = brand !== null || (categories === null && coreQuery.length >= 2);

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
 * Regex that matches common street-type abbreviations and full words as
 * whole tokens — handles commas, end-of-string, and other punctuation
 * after the token (e.g. "pkwy," or "ave.").
 */
const ADDRESS_TOKEN_RE =
  /\b(st|ave|blvd|rd|dr|ln|ct|pl|pkwy|street|avenue|boulevard|road|drive|lane|court|place|highway|hwy|parkway)\b/i;

/** Starts with a house number (digits, optionally followed by a letter like "314A"). */
const LEADING_NUMBER_RE = /^\s*\d+[a-z]?\s/i;

/**
 * Returns true if the query looks like a street address.
 * Used to boost geocoding results above POI results, and to restrict
 * Photon results to house + street layers.
 */
export function isAddressQuery(query: string): boolean {
  if (ADDRESS_TOKEN_RE.test(query)) return true;
  // "314 columbus pkwy" — leading house number + comma (city/state pattern)
  if (LEADING_NUMBER_RE.test(query) && query.includes(',')) return true;
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
  // Exact check first (already done in parseSearchQuery, but useful standalone)
  for (const key of SORTED_BRAND_KEYS) {
    if (normalized.includes(key)) return BRAND_ALIASES[key];
  }
  // Fuzzy check — only for single-word or 2-word queries that might be typos
  const words = normalized.split(/\s+/);
  if (words.length > 3) return null;

  for (const key of SORTED_BRAND_KEYS) {
    const maxDist = key.length <= 4 ? 1 : key.length <= 8 ? 2 : 3;
    const dist = levenshtein(normalized, key);
    if (dist <= maxDist && dist > 0) return BRAND_ALIASES[key];
  }
  return null;
}
