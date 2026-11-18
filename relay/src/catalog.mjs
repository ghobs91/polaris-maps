/**
 * Region catalog fetching and caching.
 *
 * The catalog is how the desktop learns which regions exist and (via each entry's
 * signed manifest) which canonical key to seed. It is fetched from the pack
 * release, cached on disk, and treated as untrusted input: `manifests.mjs` decides
 * what is pinnable, not this module.
 *
 * Deliberately offline-tolerant. A relay that cannot reach GitHub must still start,
 * seed what it already knows about, and say so — so a failed refresh keeps the
 * previous cache and reports the error instead of clearing the list.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Same default the app uses (`src/constants/config.ts`). */
export const DEFAULT_CATALOG_URL =
  'https://github.com/ghobs91/polaris-maps/releases/download/map-data-latest/catalog.json';

/** How long a cached catalog is reused before a refresh is attempted. */
export const CATALOG_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/**
 * Parse a catalog, keeping only what the relay needs.
 *
 * A catalog that is not JSON, or has no `regions` array, is an error rather than an
 * empty list: "no regions" and "I could not read the catalog" must not look the
 * same in the picker.
 *
 * @param {unknown} value
 * @returns {{ ok: true, catalog: object } | { ok: false, reason: string }}
 */
export function parseCatalog(value) {
  if (!value || typeof value !== 'object') return { ok: false, reason: 'not a JSON object' };
  const catalog = /** @type {Record<string, unknown>} */ (value);
  if (!Array.isArray(catalog.regions)) {
    return { ok: false, reason: 'catalog has no regions array' };
  }
  return { ok: true, catalog };
}

/**
 * Load the catalog: fresh cache, then network, then stale cache.
 *
 * @param {object} options
 * @param {string} options.cachePath
 * @param {string} [options.url]
 * @param {number} options.now
 * @param {number} [options.maxAgeMs]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {number} [options.timeoutMs]
 * @param {boolean} [options.force]
 * @param {(message: string) => void} [options.log]
 * @returns {Promise<{ catalog: object | null, source: 'cache' | 'network' | 'stale-cache' | 'none',
 *   fetchedAt: number, error: string | null, regionCount: number }>}
 */
export async function loadCatalog({
  cachePath,
  url = DEFAULT_CATALOG_URL,
  now,
  maxAgeMs = CATALOG_MAX_AGE_MS,
  fetchImpl = fetch,
  timeoutMs = 15_000,
  force = false,
  log = () => {},
}) {
  const cached = readCache(cachePath);

  if (!force && cached && now - cached.fetchedAt < maxAgeMs) {
    return {
      catalog: cached.catalog,
      source: 'cache',
      fetchedAt: cached.fetchedAt,
      error: null,
      regionCount: countRegions(cached.catalog),
    };
  }

  if (!url) {
    if (cached) {
      return {
        catalog: cached.catalog,
        source: 'stale-cache',
        fetchedAt: cached.fetchedAt,
        error: 'no catalog URL is configured',
        regionCount: countRegions(cached.catalog),
      };
    }
    return {
      catalog: null,
      source: 'none',
      fetchedAt: 0,
      error: 'no catalog URL is configured',
      regionCount: 0,
    };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    clearTimeout(timer);

    if (!response.ok) throw new Error(`HTTP ${response.status} from the catalog`);
    const parsed = parseCatalog(await response.json());
    if (!parsed.ok) throw new Error(parsed.reason);

    writeCache(cachePath, { catalog: parsed.catalog, fetchedAt: now });
    return {
      catalog: parsed.catalog,
      source: 'network',
      fetchedAt: now,
      error: null,
      regionCount: countRegions(parsed.catalog),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`[relay] catalog fetch failed: ${message}`);
    if (cached) {
      // Stale knowledge beats an empty picker, as long as the staleness is visible.
      return {
        catalog: cached.catalog,
        source: 'stale-cache',
        fetchedAt: cached.fetchedAt,
        error: message,
        regionCount: countRegions(cached.catalog),
      };
    }
    return { catalog: null, source: 'none', fetchedAt: 0, error: message, regionCount: 0 };
  }
}

function countRegions(catalog) {
  return Array.isArray(catalog?.regions) ? catalog.regions.length : 0;
}

function readCache(cachePath) {
  try {
    if (!fs.existsSync(cachePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    const result = parseCatalog(parsed?.catalog);
    if (!result.ok || typeof parsed?.fetchedAt !== 'number') return null;
    return { catalog: result.catalog, fetchedAt: parsed.fetchedAt };
  } catch {
    return null;
  }
}

function writeCache(cachePath, value) {
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    const tmp = `${cachePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(value)}\n`, { mode: 0o600 });
    fs.renameSync(tmp, cachePath);
  } catch {
    /* a cache that cannot be written still leaves the fetch usable in memory */
  }
}
