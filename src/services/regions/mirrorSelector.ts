/**
 * Mirror selection for region-pack assets.
 *
 * The pack CDN is deliberately multi-origin: GitHub Releases, Cloudflare R2,
 * Backblaze B2 and the Internet Archive all serve the same bytes, verified
 * against the catalog's checksum. Two problems follow from that, and both are
 * solved here rather than in the transfer loop:
 *
 *   1. **Load distribution** — if every client always starts at the primary
 *      URL, the extra origins only ever absorb an outage. A rotating start
 *      offset spreads first attempts across all origins from the first byte.
 *   2. **Wasted timeouts** — a mirror that just 404'd will 404 again. Failures
 *      put an origin in a cooldown so the next asset does not pay for it, while
 *      a success clears the penalty immediately.
 *
 * The policy is pure and takes its state by argument so it can be unit tested
 * without touching MMKV or the network; `mirrorHealth.ts` owns persistence.
 */

/** Per-origin failure state, keyed by {@link mirrorKeyFor}. */
export interface MirrorHealthEntry {
  /** Consecutive failures since the last success. */
  failures: number;
  /** Epoch ms of the most recent failure. */
  lastFailureAt: number;
  /** Epoch ms of the most recent success (0 when never seen). */
  lastSuccessAt: number;
}

export type MirrorHealth = Record<string, MirrorHealthEntry>;

/** First failure cools an origin down for this long. */
export const MIRROR_COOLDOWN_BASE_MS = 5 * 60_000;

/** Cap on the cooldown so an origin always gets another chance. */
export const MIRROR_COOLDOWN_MAX_MS = 30 * 60_000;

/** Cooldown applied after `failures` consecutive failures. */
export function cooldownMsFor(failures: number): number {
  if (failures <= 0) return 0;
  return Math.min(MIRROR_COOLDOWN_MAX_MS, MIRROR_COOLDOWN_BASE_MS * 2 ** (failures - 1));
}

/** Stable key for an origin: its host. Falls back to the raw URL when the
 *  value does not parse (e.g. a `file://` test fixture). */
export function mirrorKeyFor(url: string): string {
  try {
    const { host } = new URL(url);
    return host ? host.toLowerCase() : url;
  } catch {
    return url;
  }
}

/** True while an origin should not be preferred (but is still reachable last). */
export function isCoolingDown(
  entry: MirrorHealthEntry | undefined,
  now: number = Date.now(),
): boolean {
  if (!entry || entry.failures <= 0) return false;
  return now - entry.lastFailureAt < cooldownMsFor(entry.failures);
}

/**
 * Order the sources for one transfer.
 *
 * Healthy origins are rotated by `rotation` so concurrent clients (and
 * consecutive assets on one client) do not all start at the same place.
 * Cooling origins are appended, soonest-to-recover first, so they remain the
 * last resort rather than disappearing.
 */
export function orderSources(
  sources: ReadonlyArray<string | null | undefined>,
  options: {
    health?: MirrorHealth;
    /** Monotonic counter; pass a different value per transfer. */
    rotation?: number;
    now?: number;
  } = {},
): string[] {
  const { health = {}, rotation = 0, now = Date.now() } = options;

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const source of sources) {
    const trimmed = source?.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    unique.push(trimmed);
  }
  if (unique.length <= 1) return unique;

  const healthy: string[] = [];
  const cooling: Array<{ url: string; recoversAt: number }> = [];
  for (const url of unique) {
    const entry = health[mirrorKeyFor(url)];
    if (isCoolingDown(entry, now)) {
      cooling.push({
        url,
        recoversAt: (entry?.lastFailureAt ?? 0) + cooldownMsFor(entry?.failures ?? 0),
      });
    } else {
      healthy.push(url);
    }
  }

  const offset =
    healthy.length > 0 ? ((rotation % healthy.length) + healthy.length) % healthy.length : 0;
  const rotated = [...healthy.slice(offset), ...healthy.slice(0, offset)];
  cooling.sort((a, b) => a.recoversAt - b.recoversAt);

  return [...rotated, ...cooling.map((c) => c.url)];
}

/** Apply one outcome to the health map, returning a new map (no mutation). */
export function applyMirrorOutcome(
  health: MirrorHealth,
  url: string,
  outcome: 'success' | 'failure',
  now: number = Date.now(),
): MirrorHealth {
  const key = mirrorKeyFor(url);
  const previous = health[key] ?? { failures: 0, lastFailureAt: 0, lastSuccessAt: 0 };
  const next: MirrorHealthEntry =
    outcome === 'success'
      ? { failures: 0, lastFailureAt: previous.lastFailureAt, lastSuccessAt: now }
      : {
          failures: previous.failures + 1,
          lastFailureAt: now,
          lastSuccessAt: previous.lastSuccessAt,
        };
  return { ...health, [key]: next };
}

/** Drop origins whose failure state is old enough to be irrelevant, so the
 *  persisted map cannot grow without bound across app versions. */
export function pruneMirrorHealth(
  health: MirrorHealth,
  now: number = Date.now(),
  maxAgeMs: number = 24 * 60 * 60_000,
): MirrorHealth {
  const out: MirrorHealth = {};
  for (const [key, entry] of Object.entries(health)) {
    if (now - Math.max(entry.lastFailureAt, entry.lastSuccessAt) <= maxAgeMs) out[key] = entry;
  }
  return out;
}
