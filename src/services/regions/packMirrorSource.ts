/**
 * Which Internet Archive item carries the published packs.
 *
 * The mirror is one item per dated release — `polaris-maps-map-data-YYYY-MM` —
 * so "the latest" is not a constant: it rolls over every month, and a hardcoded
 * default would quietly point the developer picker at last month's item (or, at
 * the first rollover, at an item that does not exist yet).
 *
 * Resolution order:
 *
 *   1. the base the developer typed in Settings, when set;
 *   2. the newest `polaris-maps-map-data-*` item on the Archive, cached;
 *   3. the current UTC month, derived — right between a rollover and the first
 *      successful discovery, and correct on a fresh install before any network
 *      call has happened.
 *
 * Step 3 is why the field can autofill without a request: the naming is ours,
 * so a dev build always has a plausible target even offline. Step 2 is what
 * makes it point at what is actually published rather than what "should" be.
 *
 * Pure parsing and derivation are exported for tests, in the same shape as the
 * other policy modules under `services/regions`.
 */

import { getStorageSync } from '../storage/mmkv';
import { logDiagnostic } from '../diagnostics/diagnosticsLog';

/** Collection prefix every published pack item shares. */
export const MIRROR_ITEM_PREFIX = 'polaris-maps-map-data-';

const STORAGE_KEY = 'packs.mirror-base.v1';
const DISCOVERY_TIMEOUT_MS = 6_000;

/** Where items are downloadable from, given an identifier. */
export function mirrorBaseForItem(identifier: string): string {
  return `https://archive.org/download/${identifier}`;
}

/** `https://archive.org/download/polaris-maps-map-data-2026-11` for a date. */
export function derivedPackMirrorBase(now: number = Date.now()): string {
  const month = new Date(now).toISOString().slice(0, 7);
  return mirrorBaseForItem(`${MIRROR_ITEM_PREFIX}${month}`);
}

/**
 * Newest pack item from an Archive search response, or null when there is none.
 *
 * Deliberately tolerant: the response is somebody else's schema, and a shape
 * change should degrade to `null` (use the derived month) rather than throw
 * inside a settings screen.
 */
export function parseNewestMirrorItem(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const docs = (payload as { response?: { docs?: unknown } }).response?.docs;
  if (!Array.isArray(docs)) return null;

  let newest: { id: string; added: number } | null = null;
  for (const doc of docs) {
    if (!doc || typeof doc !== 'object') continue;
    const { identifier, addeddate } = doc as { identifier?: unknown; addeddate?: unknown };
    if (typeof identifier !== 'string' || !identifier.startsWith(MIRROR_ITEM_PREFIX)) continue;
    const added = typeof addeddate === 'string' ? Date.parse(addeddate) : Number.NaN;
    if (!newest || (Number.isFinite(added) && added > newest.added)) {
      newest = { id: identifier, added: Number.isFinite(added) ? added : 0 };
    }
  }
  return newest ? mirrorBaseForItem(newest.id) : null;
}

/** Last discovered base, when MMKV is available. */
export function cachedPackMirrorBase(): string | null {
  try {
    const raw = getStorageSync().getString(STORAGE_KEY);
    if (typeof raw !== 'string' || raw.length === 0) return null;
    const parsed = JSON.parse(raw) as { base?: unknown };
    return typeof parsed.base === 'string' && parsed.base.startsWith('https://')
      ? parsed.base
      : null;
  } catch {
    return null;
  }
}

function cachePackMirrorBase(base: string): void {
  try {
    getStorageSync().set(STORAGE_KEY, JSON.stringify({ base, at: Date.now() }));
  } catch {
    // Cache failure only costs a redundant lookup next launch.
  }
}

/** Ask the Archive for the newest published pack item. Never throws. */
export async function discoverPackMirrorBase(): Promise<string | null> {
  const url =
    'https://archive.org/advancedsearch.php' +
    `?q=identifier%3A${encodeURIComponent(`${MIRROR_ITEM_PREFIX}*`)}` +
    '&fl%5B%5D=identifier&fl%5B%5D=addeddate&sort%5B%5D=addeddate+desc&rows=10&output=json';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const base = parseNewestMirrorItem(await res.json());
    if (base) cachePackMirrorBase(base);
    return base;
  } catch (error) {
    logDiagnostic('regions', 'warn', 'mirror base discovery failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Effective mirror base: explicit setting, then discovered, then this month.
 *
 * Never returns an empty string — a dev test with "Archive" selected must always
 * have somewhere to point, and a 404 from a wrong month is a much clearer signal
 * than an empty source list.
 */
export function resolvePackMirrorBase(
  explicit: string | null | undefined,
  now: number = Date.now(),
): string {
  const trimmed = (explicit ?? '').trim();
  if (trimmed.length > 0) return trimmed.replace(/\/+$/, '');
  return cachedPackMirrorBase() ?? derivedPackMirrorBase(now);
}
