import Gun from 'gun';
import { storage } from '../storage/mmkv';

const MMKV_GUN_PREFIX = 'gun:';
const RELAY_CACHE_KEY = 'gun:cached_relays';

const SEED_RELAYS = [
  'https://gun-manhattan.herokuapp.com/gun',
  'https://gun-us.herokuapp.com/gun',
  'https://gun-eu.herokuapp.com/gun',
];

function getMMKVAdapter() {
  return {
    get(key: string, cb: (err: Error | null, data?: string | null) => void) {
      try {
        const val = storage.getString(MMKV_GUN_PREFIX + key);
        cb(null, val ?? null);
      } catch (err) {
        cb(err as Error);
      }
    },
    put(key: string, data: string, cb: (err: Error | null) => void) {
      try {
        storage.set(MMKV_GUN_PREFIX + key, data);
        cb(null);
      } catch (err) {
        cb(err as Error);
      }
    },
  };
}

function getCachedRelays(): string[] {
  const cached = storage.getString(RELAY_CACHE_KEY);
  if (cached) {
    try {
      const parsed: unknown = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.every((r) => typeof r === 'string')) {
        return parsed as string[];
      }
    } catch {
      // ignore corrupt cache
    }
  }
  return [];
}

export function cacheRelays(relays: string[]): void {
  storage.set(RELAY_CACHE_KEY, JSON.stringify(relays));
}

let gunInstance: ReturnType<typeof Gun> | null = null;

export function getGun(): ReturnType<typeof Gun> {
  if (gunInstance) return gunInstance;

  const cachedRelays = getCachedRelays();
  const peers = cachedRelays.length > 0 ? cachedRelays : SEED_RELAYS;

  gunInstance = Gun({
    peers,
    radisk: false,
    localStorage: false,
    store: getMMKVAdapter(),
  });

  return gunInstance;
}

export function resetGun(): void {
  gunInstance = null;
}
