import { storage } from '../storage/mmkv';
import type { GeocodingResult } from '../geocoding/geocodingService';

const HISTORY_KEY = 'search_history';
const MAX_HISTORY = 10;

/** Bounded boost applied when a result was previously selected for a similar query. */
export const PERSONALIZATION_BOOST = 5;

export interface SearchHistoryEntry extends GeocodingResult {
  /** Query text that produced this selection (used for personalization). */
  query?: string;
}

export function getSearchHistory(): SearchHistoryEntry[] {
  const raw = storage.getString(HISTORY_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as SearchHistoryEntry[];
  } catch {
    return [];
  }
}

export function addSearchHistory(result: GeocodingResult, query?: string): void {
  const history = getSearchHistory().filter((r) => r.entry.id !== result.entry.id);
  const entry: SearchHistoryEntry = query ? { ...result, query } : { ...result };
  history.unshift(entry);
  storage.set(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
}

export function removeSearchHistory(entryId: number): void {
  const history = getSearchHistory().filter((r) => r.entry.id !== entryId);
  storage.set(HISTORY_KEY, JSON.stringify(history));
}

export function clearSearchHistory(): void {
  storage.delete(HISTORY_KEY);
}

/**
 * Every place name previously selected for this query prefix, lowercased.
 *
 * The ranker asks for a boost per candidate; computing that per candidate
 * re-reads and re-parses the whole history on every staged emission. A search
 * with hundreds of candidates therefore parsed the same ten-entry JSON
 * hundreds of times. Read it once and test membership instead.
 */
export function getPersonalizedPlaceNames(query: string): Set<string> {
  const q = query.trim().toLowerCase();
  if (!q) return new Set();
  const names = new Set<string>();
  for (const entry of getSearchHistory()) {
    const entryQuery = entry.query?.toLowerCase();
    if (!entryQuery) continue;
    if (!q.startsWith(entryQuery) && !entryQuery.startsWith(q)) continue;
    const name = entry.entry.text.trim().toLowerCase();
    if (name) names.add(name);
  }
  return names;
}
