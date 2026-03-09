import { storage } from '../storage/mmkv';
import type { GeocodingResult } from '../geocoding/geocodingService';

const HISTORY_KEY = 'search_history';
const MAX_HISTORY = 10;

export function getSearchHistory(): GeocodingResult[] {
  const raw = storage.getString(HISTORY_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as GeocodingResult[];
  } catch {
    return [];
  }
}

export function addSearchHistory(result: GeocodingResult): void {
  const history = getSearchHistory().filter((r) => r.entry.id !== result.entry.id);
  history.unshift(result);
  storage.set(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
}

export function removeSearchHistory(entryId: number): void {
  const history = getSearchHistory().filter((r) => r.entry.id !== entryId);
  storage.set(HISTORY_KEY, JSON.stringify(history));
}

export function clearSearchHistory(): void {
  storage.delete(HISTORY_KEY);
}
