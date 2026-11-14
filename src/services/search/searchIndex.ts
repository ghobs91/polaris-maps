/**
 * The single ranked search index.
 *
 * `search_docs` is one FTS5 document table behind **both** place search and
 * address geocoding, maintained by triggers from `places` and
 * `geocoding_data` (see `database/init.ts`). Everything that ranks text —
 * the search panel's local stage, `poiService.searchPlacesFts`, and
 * `geocodingService`'s local pass — reads through this module, so a query is
 * scored once against one weight set instead of merging two independently
 * ranked result sets.
 *
 * Column weights follow the same intent as the old `places_fts` weights
 * (name ≫ brand ≫ category): a name hit is what the user typed, a category
 * hit is a hint, and a house number only matters when the query has one.
 */

import { getDatabase } from '../database/init';

export type SearchDocKind = 'poi' | 'address' | 'street' | 'locality' | 'admin';

export interface SearchDocRow {
  id: number;
  docKey: string;
  kind: SearchDocKind;
  name: string | null;
  brand: string | null;
  category: string | null;
  housenumber: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  postcode: string | null;
  country: string | null;
  lat: number;
  lng: number;
  importance: number;
  interpolated: boolean;
  regionId: string | null;
  /** `places.uuid` for POI documents, `geocoding_data.id` for address ones. */
  refId: string | null;
}

export interface SearchDocHit extends SearchDocRow {
  /** 0..1, higher is better (normalised bm25). */
  relevance: number;
}

export interface BoundingBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface SearchDocsOptions {
  query: string;
  /** Restrict to these document kinds (all kinds when omitted). */
  kinds?: SearchDocKind[];
  bbox?: BoundingBox;
  limit?: number;
  /** Bias toward this point (search centre / user location). */
  anchor?: { lat: number; lng: number };
}

/** bm25 column weights, in FTS column order. */
const FTS_WEIGHTS = '10.0, 8.0, 3.0, 6.0, 4.0, 5.0';

/** Distance bonus applied only when an anchor is supplied. */
const ANCHOR_WEIGHT = 0.15;

const DOC_SELECT = `
  SELECT d.id, d.doc_key, d.kind, d.name, d.brand, d.category, d.housenumber,
         d.street, d.city, d.state, d.postcode, d.country, d.lat, d.lng,
         d.importance, d.interpolated, d.region_id, d.ref_id
`;

/**
 * Base ranked query, exported so the schema regression suite can assert the
 * query plan against real SQLite.
 *
 * `CROSS JOIN` is load-bearing: it pins the FTS table as the outer loop. With a
 * plain JOIN, SQLite drives from `search_docs` through `idx_search_docs_bounds`
 * and probes the FTS index per row in the bbox, turning a ~4 ms keystroke query
 * into seconds as the region grows. The clauses and `LIMIT` are appended by
 * `searchDocs`.
 */
// `fts_rank`, not `rank`: FTS5 reserves `rank` as a hidden column, and the
// alias would silently resolve to that instead of the bm25 score.
export const SEARCH_DOCS_SEARCH_SQL = `${DOC_SELECT}, bm25(search_docs_fts, ${FTS_WEIGHTS}) AS fts_rank
   FROM search_docs_fts
   CROSS JOIN search_docs d ON d.id = search_docs_fts.rowid
   WHERE search_docs_fts MATCH ?`;

/**
 * Build an FTS5 match expression from free text.
 *
 * Each token becomes a quoted prefix term so "coff" matches "coffee" and the
 * FTS5 syntax characters in user input cannot break the query. Returns null
 * when the query has no usable characters.
 */
export function buildMatchQuery(text: string): string | null {
  const tokens = text
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/"/g, '').trim())
    .filter((token) => token.length > 0);
  if (tokens.length === 0) return null;
  return tokens.map((token) => `"${token}"*`).join(' ');
}

/**
 * Normalise a bm25 score into 0..1.
 *
 * bm25 is unbounded and *lower* (more negative) is better, so relevance has to
 * grow with magnitude. The 40-point scale is inherited from the previous
 * `places_fts` ranking so existing score thresholds (strong-match gates, the
 * ranker's weights) keep their meaning.
 */
export function normalizeBm25(rank: number): number {
  return Math.max(0, Math.min(1, 0.5 + -rank / 40));
}

function rowToDoc(row: Record<string, unknown>): SearchDocRow {
  return {
    id: Number(row.id),
    docKey: String(row.doc_key),
    kind: row.kind as SearchDocKind,
    name: (row.name as string | null) ?? null,
    brand: (row.brand as string | null) ?? null,
    category: (row.category as string | null) ?? null,
    housenumber: (row.housenumber as string | null) ?? null,
    street: (row.street as string | null) ?? null,
    city: (row.city as string | null) ?? null,
    state: (row.state as string | null) ?? null,
    postcode: (row.postcode as string | null) ?? null,
    country: (row.country as string | null) ?? null,
    lat: Number(row.lat),
    lng: Number(row.lng),
    importance: Number(row.importance ?? 0),
    interpolated: Number(row.interpolated ?? 0) === 1,
    regionId: (row.region_id as string | null) ?? null,
    refId: (row.ref_id as string | null) ?? null,
  };
}

function kindClause(kinds?: SearchDocKind[]): { sql: string; params: string[] } {
  if (!kinds || kinds.length === 0) return { sql: '', params: [] };
  return {
    sql: ` AND d.kind IN (${kinds.map(() => '?').join(', ')})`,
    params: kinds,
  };
}

function bboxClause(bbox?: BoundingBox): { sql: string; params: number[] } {
  if (!bbox) return { sql: '', params: [] };
  return {
    sql: ' AND d.lat BETWEEN ? AND ? AND d.lng BETWEEN ? AND ?',
    params: [bbox.south, bbox.north, bbox.west, bbox.east],
  };
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Ranked search across the unified index.
 *
 * `CROSS JOIN` is load-bearing (same reason as the old `places_fts` query): it
 * pins the FTS table as the outer loop. With a plain JOIN, SQLite drives from
 * `search_docs` through the bbox index and probes FTS per row, turning a ~4 ms
 * query into seconds as the region grows.
 */
export async function searchDocs(options: SearchDocsOptions): Promise<SearchDocHit[]> {
  const match = buildMatchQuery(options.query);
  if (!match) return [];

  const limit = options.limit ?? 50;
  const db = await getDatabase();
  const kinds = kindClause(options.kinds);
  const bbox = bboxClause(options.bbox);

  try {
    const rows = await db.getAllAsync<Record<string, unknown>>(
      `${SEARCH_DOCS_SEARCH_SQL}${kinds.sql}${bbox.sql}
       ORDER BY fts_rank, d.importance DESC
       LIMIT ?`,
      [match, ...kinds.params, ...bbox.params, Math.max(limit * 3, limit)],
    );

    const hits = rows.map((row) => ({
      ...rowToDoc(row),
      relevance: normalizeBm25(Number(row.fts_rank ?? 0)),
    }));

    return rankHits(hits, options.anchor).slice(0, limit);
  } catch {
    // Index unavailable (pre-migration DB, FTS corruption) — the caller falls
    // back to its LIKE path or the network.
    return [];
  }
}

/**
 * Typo-tolerant follow-up: trigram matching over name/street/city.
 *
 * Always ranked below exact prefix hits, and only worth running when the
 * primary pass is thin.
 */
export async function searchDocsFuzzy(
  options: SearchDocsOptions & { minLength?: number },
): Promise<SearchDocHit[]> {
  const text = options.query
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length < (options.minLength ?? 4)) return [];

  const limit = options.limit ?? 20;
  const db = await getDatabase();
  const kinds = kindClause(options.kinds);
  const bbox = bboxClause(options.bbox);

  try {
    const rows = await db.getAllAsync<Record<string, unknown>>(
      `${DOC_SELECT}
       FROM search_docs_trigram t
       CROSS JOIN search_docs d ON d.id = t.rowid
       WHERE search_docs_trigram MATCH ?${kinds.sql}${bbox.sql}
       LIMIT ?`,
      [`"${text}"`, ...kinds.params, ...bbox.params, Math.max(limit * 3, limit)],
    );

    const hits = rows.map((row, index) => ({
      ...rowToDoc(row),
      // Trigram has no bm25 column ordering; keep a deterministic decay so
      // these always sort below a real prefix match.
      relevance: 0.35 * (1 - index / Math.max(1, rows.length)),
    }));
    return rankHits(hits, options.anchor).slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * Blend text relevance with proximity when a search anchor is known.
 * Without an anchor the bm25 + importance order is preserved untouched.
 */
export function rankHits(
  hits: SearchDocHit[],
  anchor?: { lat: number; lng: number },
): SearchDocHit[] {
  if (!anchor) return hits;
  return [...hits].sort((a, b) => score(b) - score(a));

  function score(hit: SearchDocHit): number {
    const km = haversineKm(anchor!.lat, anchor!.lng, hit.lat, hit.lng);
    return hit.relevance + ANCHOR_WEIGHT / (1 + km) + hit.importance / 100;
  }
}

/** Every known numbered address on a street, for query-time interpolation. */
export async function houseNumbersOnStreet(
  street: string,
  options: { bbox?: BoundingBox; limit?: number } = {},
): Promise<Array<{ housenumber: string; lat: number; lng: number }>> {
  const needle = street.trim().toLowerCase();
  if (!needle) return [];

  const db = await getDatabase();
  const bbox = bboxClause(options.bbox);
  try {
    const rows = await db.getAllAsync<{ housenumber: string; lat: number; lng: number }>(
      `SELECT d.housenumber, d.lat, d.lng
       FROM search_docs d
       WHERE d.kind = 'address'
         AND d.housenumber IS NOT NULL
         AND lower(d.street) = ?${bbox.sql}
       LIMIT ?`,
      [needle, ...bbox.params, options.limit ?? 200],
    );
    return rows;
  } catch {
    return [];
  }
}

/** Count documents matching a kind set, used by gates that need to know
 *  whether the local index can answer at all. */
export async function countSearchDocs(kinds?: SearchDocKind[]): Promise<number> {
  const db = await getDatabase();
  const kindsClause =
    kinds && kinds.length > 0 ? `WHERE kind IN (${kinds.map(() => '?').join(', ')})` : '';
  try {
    const row = await db.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM search_docs ${kindsClause}`,
      kinds ?? [],
    );
    return row?.n ?? 0;
  } catch {
    return 0;
  }
}
