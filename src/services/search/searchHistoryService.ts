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
 * Bounded personalization boost: the user previously selected this exact
 * place for the same (or a prefix of the) query. Local-only, no network.
 */
export function getPersonalizationBoost(query: string, placeName: string): number {
  const q = query.trim().toLowerCase();
  const name = placeName.trim().toLowerCase();
  if (!q || !name) return 0;

  const hit = getSearchHistory().some(
    (entry) =>
      entry.entry.text.trim().toLowerCase() === name &&
      !!entry.query &&
      (q.startsWith(entry.query.toLowerCase()) || entry.query.toLowerCase().startsWith(q)),
  );
  return hit ? PERSONALIZATION_BOOST : 0;
}
