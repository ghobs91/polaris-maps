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
 *
 * Verified live on 2026-11-12 by completing the Gun handshake and by writing a
 * record on one connection and reading it back on a second (3/3 runs).
 *
 * The previous list (`gun-{manhattan,us,eu}.herokuapp.com`) had been dead since
 * Heroku removed its free tier: all three now answer `404` with an HTML page.
 * They survived because the old probe treated any status below 500 as healthy —
 * see the module comment in `relayHealth.ts`.
 *
 * ## Adding a seed
 *
 * A relay belongs here only if it is *public* infrastructure with a stated
 * mandate to serve third-party apps. Most hosts that still answer a Gun
 * handshake are somebody's private deployment (e.g. `gun-relay-3dvr.fly.dev`,
 * whose own README says "Private 3DVR relay used by the portal and 3DVR
 * Companion") — pointing a maps app at those is freeloading on one project's
 * server and they may legitimately cut it off. Verify a candidate with:
 *
 *   node scripts/probe-gun-relays.mjs wss://candidate/gun
 *
 * which performs the handshake and the round-trip, then add it here.
 *
 * A single seed is not a resilient pool; that is the current state of the
 * public Gun network, not a choice. Gun sync is best-effort by design and every
 * write path that uses it has to tolerate "no relay answered".
 */
const SEED_RELAYS = ['wss://try.axe.eco/gun'];

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
