/**
 * Name normalization and fuzzy similarity for matching a Polaris/Overture
 * place against OpenStreetMap elements.
 *
 * OSM names are free-form: "McDonald's", "McDonalds", "STARBUCKS",
 * "St. Mary's Hospital" and "Saint Marys Hospital" can all describe the same
 * place. These helpers fold those variations so the pre-submission existence
 * check recognises an already-mapped place instead of creating a duplicate.
 *
 * The approach mirrors Overture's own conflation matcher, which compares name
 * similarity while treating common "core words" (shop, restaurant, …) as
 * low-information.
 */

/** Generic category/entity words that carry little identity. */
const CORE_WORDS = new Set([
  // articles / connectives
  'the',
  'a',
  'an',
  'of',
  'and',
  'at',
  'by',
  'for',
  'to',
  'in',
  'on',
  // generic business/POI words
  'shop',
  'store',
  'restaurant',
  'cafe',
  'coffee',
  'bar',
  'pub',
  'grill',
  'kitchen',
  'diner',
  'bakery',
  'market',
  'supermarket',
  'grocery',
  'hotel',
  'motel',
  'inn',
  'bank',
  'pharmacy',
  'salon',
  'spa',
  'gym',
  'fitness',
  'clinic',
  'hospital',
  'school',
  'church',
  'park',
  'parking',
  'garage',
  'station',
  'center',
  'centre',
  'plaza',
  'mall',
  'cinema',
  'theater',
  'theatre',
  'museum',
  'library',
  'office',
  // legal suffixes
  'company',
  'co',
  'inc',
  'llc',
  'ltd',
]);

/**
 * Common name abbreviations expanded before comparison. Kept intentionally
 * small and name-safe ("Dr." is left alone, since it means Doctor in names).
 */
const TOKEN_ALIASES: Record<string, string> = {
  st: 'saint',
  mt: 'mount',
  ft: 'fort',
};

/** Fold combining diacritical marks: "café" → "cafe". */
export function stripDiacritics(input: string): string {
  return input.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Lowercase, fold diacritics, unify `&` with `and`, drop apostrophes and
 * punctuation, and collapse whitespace.
 */
export function normalizeOsmName(raw: string): string {
  return stripDiacritics(raw)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Normalized tokens with common abbreviations expanded. */
export function nameTokens(raw: string): string[] {
  return normalizeOsmName(raw)
    .split(' ')
    .filter(Boolean)
    .map((t) => TOKEN_ALIASES[t] ?? t);
}

/**
 * Identity-bearing tokens (core category words removed). Falls back to all
 * tokens when a name consists only of core words (e.g. "Cafe").
 */
export function significantTokens(raw: string): string[] {
  const tokens = nameTokens(raw).filter((t) => t.length >= 2 && !CORE_WORDS.has(t));
  return tokens.length > 0 ? tokens : nameTokens(raw);
}

/** Optimal String Alignment (Damerau-Levenshtein) distance — handles swaps. */
export function damerauLevenshtein(a: string, b: string): number {
  const la = a.length;
  const lb = b.length;
  if (la === 0) return lb;
  if (lb === 0) return la;

  const maxDist = la + lb;
  const d: number[][] = Array.from({ length: la + 2 }, () => new Array<number>(lb + 2).fill(0));
  d[0][0] = maxDist;
  for (let i = 0; i <= la; i++) {
    d[i + 1][0] = maxDist;
    d[i + 1][1] = i;
  }
  for (let j = 0; j <= lb; j++) {
    d[0][j + 1] = maxDist;
    d[1][j + 1] = j;
  }

  const lastSeen = new Map<string, number>();
  for (let i = 1; i <= la; i++) {
    let lastMatch = 0;
    for (let j = 1; j <= lb; j++) {
      const prevRow = lastSeen.get(b[j - 1]) ?? 0;
      const prevCol = lastMatch;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      if (cost === 0) lastMatch = j;
      d[i + 1][j + 1] = Math.min(
        d[i][j] + cost,
        d[i + 1][j] + 1,
        d[i][j + 1] + 1,
        d[prevRow][prevCol] + (i - prevRow - 1) + 1 + (j - prevCol - 1),
      );
    }
    lastSeen.set(a[i - 1], i);
  }
  return d[la + 1][lb + 1];
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const sa = new Set(a);
  const sb = new Set(b);
  let intersection = 0;
  for (const t of sa) if (sb.has(t)) intersection++;
  let union = sa.size;
  for (const t of sb) if (!sa.has(t)) union++;
  return union === 0 ? 0 : intersection / union;
}

const CORE_CONFLICT_CEILING = 0.75;

/**
 * Similarity score in [0, 1] between two place names.
 *
 * Takes the greater of token-set similarity (core words ignored, so
 * "Starbucks Coffee" matches "Starbucks") and character-level
 * Damerau-Levenshtein similarity, which is intentionally biased toward
 * recognising duplicates.
 *
 * When both names contain core category words that don't overlap
 * (e.g. "Central Park" vs "Central Parking") the score is capped, so two
 * different kinds of place sharing a distinctive token don't look identical.
 */
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeOsmName(a);
  const nb = normalizeOsmName(b);
  if (!na || !nb) return na === nb ? 1 : 0;
  if (na === nb) return 1;

  const tokenSim = jaccard(significantTokens(a), significantTokens(b));

  const ca = na.replace(/ /g, '');
  const cb = nb.replace(/ /g, '');
  const maxLen = Math.max(ca.length, cb.length);
  const charSim = maxLen === 0 ? 1 : 1 - damerauLevenshtein(ca, cb) / maxLen;

  let score = Math.max(tokenSim, charSim);

  const coreA = nameTokens(a).filter((t) => CORE_WORDS.has(t));
  const coreB = nameTokens(b).filter((t) => CORE_WORDS.has(t));
  const coreConflict =
    coreA.length > 0 && coreB.length > 0 && !coreA.some((t) => coreB.includes(t));
  if (coreConflict) score = Math.min(score, CORE_CONFLICT_CEILING);

  return score;
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\"]/g, '\\$&');
}

/**
 * Build a case-insensitive Overpass regex that broadly finds candidate names.
 *
 * Uses the identity-bearing tokens (so "Starbucks Coffee" still matches a node
 * named "Starbucks Coffee Company"), which intentionally over-fetches; the
 * local scorer then decides whether any candidate is really the same place.
 */
export function buildOverpassNameRegex(name: string): string {
  const normalized = normalizeOsmName(name);
  if (!normalized) return '';
  const tokens = significantTokens(name).filter((t) => t.length >= 3);
  const chosen = tokens.length > 0 ? tokens : [normalized.replace(/ /g, '')];
  return [...new Set(chosen)].map(escapeRegExp).join('|');
}
