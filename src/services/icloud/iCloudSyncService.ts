import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import type { PlaceList } from '../../models/placeList';
import type { FavoriteLocation } from '../favorites/favoritesService';

export const LISTS_KEY = 'place_lists.json';
export const FAVORITES_KEY = 'favorites.json';

/**
 * NSUbiquitousKeyValueStore caps out around 1MB total with small per-key
 * limits (~64KB). Refuse oversized writes instead of silently losing data —
 * callers get `false` and can surface a warning. Large libraries need a
 * CloudKit / iCloud Drive backend, which this bridge does not provide.
 */
export const MAX_KVS_VALUE_BYTES = 60 * 1024;

interface CloudStoreModule {
  isAvailable(): Promise<boolean>;
  write(filename: string, data: string): Promise<boolean>;
  read(filename: string): Promise<string | null>;
  remove(filename: string): Promise<boolean>;
}

const CloudStore: CloudStoreModule | null =
  Platform.OS === 'ios' ? NativeModules.PolarisCloudStore : null;

let emitter: NativeEventEmitter | null = null;
function getEmitter(): NativeEventEmitter | null {
  if (Platform.OS !== 'ios' || !CloudStore) return null;
  if (!emitter) {
    emitter = new NativeEventEmitter(NativeModules.PolarisCloudStore);
  }
  return emitter;
}

export async function isICloudAvailable(): Promise<boolean> {
  if (!CloudStore) return false;
  try {
    return await CloudStore.isAvailable();
  } catch {
    return false;
  }
}

export function utf8ByteLength(value: string): number {
  try {
    if (typeof TextEncoder !== 'undefined') {
      return new TextEncoder().encode(value).length;
    }
  } catch {
    // Fall through to the manual estimate below.
  }
  let length = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x80) {
      length += 1;
    } else if (code < 0x800) {
      length += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        length += 4;
        i++;
      } else {
        length += 3;
      }
    } else {
      length += 3;
    }
  }
  return length;
}

async function writeKey(key: string, value: unknown): Promise<boolean> {
  if (!CloudStore) return false;
  try {
    const available = await CloudStore.isAvailable();
    if (!available) return false;
    const json = JSON.stringify(value);
    if (utf8ByteLength(json) > MAX_KVS_VALUE_BYTES) {
      console.warn(
        `[iCloudSync] Payload for "${key}" exceeds the key-value size limit ` +
          'and was not written. Large libraries need CloudKit / iCloud Drive.',
      );
      return false;
    }
    return await CloudStore.write(key, json);
  } catch {
    return false;
  }
}

async function readKey<T>(key: string): Promise<T | null> {
  if (!CloudStore) return null;
  try {
    const available = await CloudStore.isAvailable();
    if (!available) return null;
    const raw = await CloudStore.read(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    // A missing key, a partially synced value, or a corrupt payload all
    // surface as null so callers never merge garbage over local data.
    // Note: null is ambiguous — it means "no confirmed cloud data", not
    // "cloud is empty". Callers must not treat it as permission to push
    // an empty local state over the cloud copy (see useICloudSync).
    return Array.isArray(parsed) ? (parsed as T) : null;
  } catch {
    return null;
  }
}

export async function writeListsToICloud(lists: PlaceList[]): Promise<boolean> {
  return writeKey(LISTS_KEY, lists);
}

export async function readListsFromICloud(): Promise<PlaceList[] | null> {
  return readKey<PlaceList[]>(LISTS_KEY);
}

export async function writeFavoritesToICloud(favorites: FavoriteLocation[]): Promise<boolean> {
  return writeKey(FAVORITES_KEY, favorites);
}

export async function readFavoritesFromICloud(): Promise<FavoriteLocation[] | null> {
  return readKey<FavoriteLocation[]>(FAVORITES_KEY);
}

/**
 * Merge cloud lists with local lists.
 * Strategy: cloud wins for lists with same ID but newer updatedAt;
 * lists only in one side are preserved.
 */
export function mergeLists(local: PlaceList[], cloud: PlaceList[]): PlaceList[] {
  const merged = new Map<string, PlaceList>();

  for (const list of local) {
    merged.set(list.id, list);
  }

  for (const cloudList of cloud) {
    const existing = merged.get(cloudList.id);
    if (!existing || cloudList.updatedAt > existing.updatedAt) {
      merged.set(cloudList.id, cloudList);
    }
  }

  return Array.from(merged.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Merge cloud favorites (Home/Work/pins) with local favorites.
 * Favorites carry no timestamps, so same-ID conflicts keep the local
 * entry and entries unique to either side are preserved. Home sorts
 * first, Work second, matching favoritesService ordering.
 */
export function mergeFavorites(
  local: FavoriteLocation[],
  cloud: FavoriteLocation[],
): FavoriteLocation[] {
  const merged = new Map<string, FavoriteLocation>();

  for (const fav of cloud) {
    merged.set(fav.id, fav);
  }

  for (const fav of local) {
    merged.set(fav.id, fav);
  }

  const rank = (fav: FavoriteLocation): number =>
    fav.kind === 'home' ? 0 : fav.kind === 'work' ? 1 : 2;
  return Array.from(merged.values()).sort((a, b) => rank(a) - rank(b));
}

let listsDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let favoritesDebounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Debounced write of place lists to iCloud. Batches rapid updates.
 */
export function scheduleICloudSync(lists: PlaceList[]): void {
  if (listsDebounceTimer) clearTimeout(listsDebounceTimer);
  listsDebounceTimer = setTimeout(() => {
    void writeListsToICloud(lists);
  }, 2000);
}

/**
 * Debounced write of favorites to iCloud. Batches rapid updates.
 */
export function scheduleFavoritesSync(favorites: FavoriteLocation[]): void {
  if (favoritesDebounceTimer) clearTimeout(favoritesDebounceTimer);
  favoritesDebounceTimer = setTimeout(() => {
    void writeFavoritesToICloud(favorites);
  }, 2000);
}

/**
 * Subscribe to iCloud file change events.
 * Returns unsubscribe function.
 */
export function onICloudChange(callback: () => void): () => void {
  const em = getEmitter();
  if (!em) return () => {};
  const sub = em.addListener('onCloudStoreChange', callback);
  return () => sub.remove();
}
