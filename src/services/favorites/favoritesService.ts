import { storage } from '../storage/mmkv';
import type { GeocodingEntry } from '../../models/geocoding';

export type FavoriteKind = 'home' | 'work' | 'pin';

export interface FavoriteLocation {
  id: string;
  kind: FavoriteKind;
  label: string;
  entry: GeocodingEntry;
}

const FAVORITES_KEY = 'favorites_v1';

export function getFavorites(): FavoriteLocation[] {
  const raw = storage.getString(FAVORITES_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as FavoriteLocation[];
  } catch {
    return [];
  }
}

export function setFavorite(fav: FavoriteLocation): void {
  const list = getFavorites().filter((f) => f.id !== fav.id);
  // Home and Work are always first
  if (fav.kind === 'home') {
    storage.set(FAVORITES_KEY, JSON.stringify([fav, ...list.filter((f) => f.kind !== 'home')]));
  } else if (fav.kind === 'work') {
    const home = list.find((f) => f.kind === 'home');
    const rest = list.filter((f) => f.kind !== 'home' && f.kind !== 'work');
    const ordered = [...(home ? [home] : []), fav, ...rest];
    storage.set(FAVORITES_KEY, JSON.stringify(ordered));
  } else {
    storage.set(FAVORITES_KEY, JSON.stringify([...list, fav]));
  }
}

export function removeFavorite(id: string): void {
  const list = getFavorites().filter((f) => f.id !== id);
  storage.set(FAVORITES_KEY, JSON.stringify(list));
}

export function getHome(): FavoriteLocation | undefined {
  return getFavorites().find((f) => f.kind === 'home');
}

export function getWork(): FavoriteLocation | undefined {
  return getFavorites().find((f) => f.kind === 'work');
}
