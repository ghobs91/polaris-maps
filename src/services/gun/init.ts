import Gun from 'gun';
import { storage } from '../storage/mmkv';
import { isRelayHealthStale, primeRelayHealth, resolveRelayPeers } from './relayHealth';

const MMKV_GUN_PREFIX = 'gun:';
const RELAY_CACHE_KEY = 'gun:cached_relays';

/**
 * Seed relays. These are community relays, not project infrastructure. A dead
 * entry is dropped from the working set by the health probe in `relayHealth`
 * (see `resolveRelayPeers`), and `EXPO_PUBLIC_GUN_RELAYS` overrides them
 * entirely.
 */
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

export function cacheRelays(relays: string[]): void {
  storage.set(RELAY_CACHE_KEY, JSON.stringify(relays));
}

let gunInstance: ReturnType<typeof Gun> | null = null;

export function getGun(): ReturnType<typeof Gun> {
  if (gunInstance) return gunInstance;

  // Cached-healthy set, then seeds; probing happens in the background below so
  // Gun's constructor never blocks on a relay that may be dead.
  const peers = resolveRelayPeers(SEED_RELAYS);

  gunInstance = Gun({
    peers,
    radisk: false,
    localStorage: false,
    store: getMMKVAdapter(),
  });

  if (isRelayHealthStale()) {
    // Self-healing seed list: whatever answers now becomes the next launch's
    // working set, without adding relays the project does not already ship.
    void primeRelayHealth(peers)
      .then((healthy) => {
        if (healthy.length > 0) cacheRelays(healthy);
      })
      .catch(() => {
        // Offline: keep using the current set.
      });
  }

  return gunInstance;
}

export function resetGun(): void {
  gunInstance = null;
}
