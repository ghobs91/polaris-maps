#!/usr/bin/env node
/**
 * Verify that every pack origin the catalog advertises actually serves the bytes.
 *
 * The catalog is the only place the app learns about origins: each asset carries
 * its alternates in `assets[].mirrors`, and `assetBaseUrls` covers the routing
 * tarballs, which are not listed per asset. An origin that is uploaded but not
 * listed is never used; an origin that is listed but not uploaded turns into a
 * failed transfer on every device that rotates onto it (and, because
 * `mirrorHealth` demotes on failure, a burst of them at launch).
 *
 * A mismatch does not say *which* side is wrong. Since the catalog is republished
 * at chunk boundaries while later chunks rebuild regions, the usual cause is that
 * the catalog still describes the previous build of a region — and the primary and
 * the mirror both hold the new bytes. So every mismatch is cross-checked against
 * the asset's primary URL before it is reported:
 *
 *   primary agrees with the origin under test  → the catalog is stale
 *   primary disagrees with it                  → the two origins really differ
 *
 * Usage:
 *   node scripts/verify-pack-mirrors.mjs [options]
 *
 * Options:
 *   --catalog <path|url>  Catalog to check (default: the published one)
 *   --source <what>       mirror (default) | primary | both
 *   --mirror <base>       Only check URLs under this base (repeatable)
 *   --assets <names>      Comma-separated asset names to check (default: all)
 *   --regions <n>         Check the first n regions (default: all)
 *   --regions-file <path> Only these region ids (JSON array) — used by CI to
 *                        verify just the regions a run rebuilt
 *   --json <path>         Write a machine-readable summary (ok/failed)
 *   --concurrency <n>     Parallel probes (default 4)
 *   --timeout <ms>        Per-request timeout (default 20000)
 *   --no-cross-check      Report mismatches without comparing to the primary
 *   --warn-only           Report failures but exit 0
 *   --help                Show this text
 *
 * Exit codes: 0 every asset under test matched its catalog entry, 1 any did not.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  const src = readFileSync(new URL(import.meta.url), 'utf8');
  const header = src.slice(src.indexOf('/**') + 3, src.indexOf('*/'));
  console.log(
    header
      .split('\n')
      .map((line) => line.replace(/^\s?\* ?/, ''))
      .join('\n'),
  );
  process.exit(0);
}

function flag(name, fallback) {
  const i = args.indexOf(name);
  if (i === -1) return fallback;
  const value = args[i + 1];
  if (!value || value.startsWith('--')) {
    console.error(`${name} needs a value`);
    process.exit(1);
  }
  return value;
}

function flags(name) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== name) continue;
    const value = args[i + 1];
    if (value && !value.startsWith('--')) out.push(value);
  }
  return out;
}

// Same defaults as `src/constants/config.ts`; kept in sync by hand because this
// script is plain ESM and cannot import the TS constants.
const DATA_REPO = process.env.EXPO_PUBLIC_REGION_DATA_REPO ?? 'ghobs91/polaris-maps';
const DATA_BASE = `https://github.com/${DATA_REPO}/releases/download/map-data-latest`;

const CATALOG_SPEC =
  flag('--catalog', process.env.EXPO_PUBLIC_REGION_CATALOG_URL ?? '') ||
  `${DATA_BASE}/catalog.json`;
const SOURCE = flag('--source', 'mirror');
const MIRROR_FILTERS = flags('--mirror');
const ASSET_FILTER = flag('--assets', '')
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean);
const REGION_LIMIT = Number(flag('--regions', '0'));
const REGIONS_FILE = flag('--regions-file', '');
const JSON_OUT = flag('--json', '');
const CONCURRENCY = Math.max(1, Number(flag('--concurrency', '4')));
const TIMEOUT_MS = Number(flag('--timeout', '20000'));
const WARN_ONLY = args.includes('--warn-only');
const CROSS_CHECK = !args.includes('--no-cross-check');

if (!['mirror', 'primary', 'both'].includes(SOURCE)) {
  console.error(`--source must be mirror, primary or both (got ${SOURCE})`);
  process.exit(1);
}

const USER_AGENT = 'PolarisMaps/1.0 (+https://app.polarismaps.app)';

/** Region ids to check, when the caller wants a subset (CI verifies what it rebuilt). */
const ONLY_REGIONS = (() => {
  if (!REGIONS_FILE) return null;
  try {
    const ids = JSON.parse(readFileSync(resolve(REGIONS_FILE), 'utf8'));
    if (!Array.isArray(ids)) throw new Error('expected a JSON array of region ids');
    return new Set(ids.map(String));
  } catch (error) {
    console.error(`--regions-file ${REGIONS_FILE}: ${error.message}`);
    process.exit(1);
  }
})();

async function loadCatalog(spec) {
  if (/^https?:\/\//i.test(spec)) {
    const res = await fetch(spec, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`catalog → HTTP ${res.status}`);
    return res.json();
  }
  return JSON.parse(readFileSync(resolve(spec), 'utf8'));
}

/** `bytes 0-0/4138134` → 4138134; null when the origin ignored the range. */
function totalFromContentRange(header) {
  const match = /\/(\d+)\s*$/.exec(header ?? '');
  return match ? Number(match[1]) : null;
}

/**
 * Probe one URL without absorbing it.
 *
 * A ranged GET is used instead of HEAD because several origins refuse HEAD, and
 * because `Content-Range` carries the authoritative total size — which is what
 * the catalog's `sizeBytes` has to match for a resumable transfer to be
 * possible at all.
 */
async function probe(url) {
  const startedAt = Date.now();
  const res = await fetch(url, {
    headers: { Range: 'bytes=0-0', 'User-Agent': USER_AGENT },
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const size =
    res.status === 206
      ? totalFromContentRange(res.headers.get('content-range'))
      : Number(res.headers.get('content-length')) || null;
  const acceptRanges = res.headers.get('accept-ranges');
  res.body?.cancel?.();
  return { status: res.status, size, acceptRanges, ms: Date.now() - startedAt };
}

const iaMetadataCache = new Map();

/** md5 the Internet Archive reports for a file inside an item, or null. */
async function iaMd5(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!/(^|\.)archive\.org$/i.test(parsed.hostname)) return null;

  const segments = parsed.pathname.split('/').filter(Boolean);
  const downloadAt = segments.indexOf('download');
  if (downloadAt === -1 || !segments[downloadAt + 1]) return null;
  const item = segments[downloadAt + 1];
  const fileName = segments.slice(downloadAt + 2).join('/');

  if (!iaMetadataCache.has(item)) {
    iaMetadataCache.set(
      item,
      fetch(`https://archive.org/metadata/${item}`, {
        headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null),
    );
  }
  const meta = await iaMetadataCache.get(item);
  const file = (meta?.files ?? []).find((entry) => entry?.name === fileName);
  return typeof file?.md5 === 'string' ? file.md5.toLowerCase() : null;
}

/** Every (region, asset, url) to probe, for the requested source(s). */
function collectTargets(catalog) {
  const regions = (catalog.regions ?? catalog.include ?? [])
    .filter((region) => !ONLY_REGIONS || ONLY_REGIONS.has(region.id))
    .slice(0, REGION_LIMIT > 0 ? REGION_LIMIT : undefined);
  const targets = [];

  for (const region of regions) {
    for (const asset of region.assets ?? []) {
      if (ASSET_FILTER.length > 0 && !ASSET_FILTER.includes(asset.name)) continue;

      // Each advertised origin is probed on its own. `kind` decides how a
      // mismatch is read: a primary that disagrees with the catalog means the
      // catalog is stale; two origins that disagree mean one of them is wrong.
      if (SOURCE !== 'primary') {
        for (const mirror of asset.mirrors ?? []) {
          targets.push({
            regionId: region.id,
            asset: asset.name,
            url: mirror,
            kind: 'mirror',
            crossCheckUrl: asset.url || null,
            sizeBytes: asset.sizeBytes,
            md5: asset.md5 ? String(asset.md5).toLowerCase() : undefined,
          });
        }
      }
      if (SOURCE !== 'mirror' && asset.url) {
        targets.push({
          regionId: region.id,
          asset: asset.name,
          url: asset.url,
          kind: 'primary',
          crossCheckUrl: null,
          sizeBytes: asset.sizeBytes,
          md5: asset.md5 ? String(asset.md5).toLowerCase() : undefined,
        });
      }
    }
  }

  // Routing tarballs are built from `assetBaseUrls`, not listed per asset. There
  // is no manifest entry to read their size from, so they are checked for
  // reachability only.
  const baseUrls = (catalog.assetBaseUrls ?? []).filter(
    (base) => typeof base === 'string' && base.trim().length > 0,
  );
  if (ASSET_FILTER.length === 0 || ASSET_FILTER.includes('routing.tar')) {
    for (const region of regions) {
      const primary = (region.assets ?? []).map((asset) => asset.url).find(Boolean);
      const tagMatch = primary && /\/releases\/download\/([^/]+)\//.exec(primary);
      if (!tagMatch) continue;
      const tag = tagMatch[1];
      for (const base of baseUrls) {
        const url = `${base.replace(/\/+$/, '')}/${tag}/${region.id}-routing.tar`;
        targets.push({ regionId: region.id, asset: 'routing.tar', url, kind: 'mirror' });
      }
    }
  }

  const seen = new Set();
  return targets.filter((target) => {
    if (MIRROR_FILTERS.length > 0 && !MIRROR_FILTERS.some((base) => target.url.startsWith(base))) {
      return false;
    }
    if (seen.has(target.url)) return false;
    seen.add(target.url);
    return true;
  });
}

async function runLimited(items, limit, worker) {
  const results = [];
  let cursor = 0;
  async function next() {
    while (cursor < items.length) {
      const item = items[cursor++];
      results.push(await worker(item));
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, next));
  return results;
}

/**
 * Decide whose fault a mismatch is.
 *
 * Cheap and decisive: compare the failing origin's reported size with the
 * primary's. Equal bytes from two independent hosts cannot both be wrong about
 * what was published, so the catalog is the stale party. Different bytes mean a
 * real disagreement that no retry will fix.
 */
async function classify(target, reason, observedSize) {
  if (!CROSS_CHECK || !target.crossCheckUrl || target.crossCheckUrl === target.url) {
    return { verdict: 'mismatch', reason };
  }
  try {
    const primary = await probe(target.crossCheckUrl);
    if (primary.size == null) return { verdict: 'mismatch', reason };
    if (observedSize != null && primary.size === observedSize) {
      return {
        verdict: 'catalog-stale',
        reason: `${reason} · primary agrees with ${target.kind} (${primary.size} B)`,
      };
    }
    return {
      verdict: 'origins-disagree',
      reason: `${reason} · primary reports ${primary.size} B`,
    };
  } catch (error) {
    return { verdict: 'mismatch', reason: `${reason} · cross-check failed: ${error.message}` };
  }
}

async function checkTarget(target) {
  try {
    const probeResult = await probe(target.url);
    // The Internet Archive answers a missing item with 503 (not 404) and a
    // darked one with 403, so "not there" is wider than one status code.
    if ([403, 404, 410, 503].includes(probeResult.status)) {
      return {
        ...target,
        ok: false,
        verdict: 'not-served',
        reason: `not served (HTTP ${probeResult.status}) — origin missing, dark, or still ingesting`,
      };
    }
    if (![200, 206].includes(probeResult.status)) {
      return { ...target, ok: false, verdict: 'not-served', reason: `HTTP ${probeResult.status}` };
    }

    const observedSize = probeResult.size;
    if (observedSize != null && target.sizeBytes != null && observedSize !== target.sizeBytes) {
      const reason = `size ${observedSize} ≠ catalog ${target.sizeBytes}`;
      return {
        ...target,
        ok: false,
        observedSize,
        ...(await classify(target, reason, observedSize)),
      };
    }
    if (probeResult.acceptRanges && probeResult.acceptRanges !== 'bytes') {
      return {
        ...target,
        ok: false,
        verdict: 'mismatch',
        reason: `Accept-Ranges: ${probeResult.acceptRanges}`,
      };
    }

    // A truncated or wrong object that happens to have the right size is what a
    // resumable client cannot detect on its own, so the md5 is checked wherever
    // the origin can report one.
    const remoteMd5 = await iaMd5(target.url);
    if (remoteMd5 && target.md5 && remoteMd5 !== target.md5) {
      const reason = `md5 ${remoteMd5} ≠ catalog ${target.md5}`;
      return {
        ...target,
        ok: false,
        observedSize,
        ...(await classify(target, reason, observedSize)),
      };
    }
    return {
      ...target,
      ok: true,
      verdict: 'ok',
      remoteMd5: remoteMd5 ?? undefined,
      ms: probeResult.ms,
    };
  } catch (error) {
    return {
      ...target,
      ok: false,
      verdict: 'mismatch',
      reason: error instanceof Error ? error.message : 'failed',
    };
  }
}

const VERDICT_HINT = {
  'not-served': 'the origin does not have these bytes — upload, or check the tag path',
  'catalog-stale': 'both origins agree; the catalog still describes the previous build',
  'origins-disagree': 'the origins hold different bytes — one of them is wrong',
  mismatch: 'see the detail above',
};

let catalog;
try {
  catalog = await loadCatalog(CATALOG_SPEC);
} catch (error) {
  console.error(`Could not load catalog ${CATALOG_SPEC}: ${error.message}`);
  process.exit(1);
}

const targets = collectTargets(catalog);
const bases = [...new Set(targets.map((target) => new URL(target.url).origin))];

console.log('Polaris pack-origin verification');
console.log(`  catalog  ${CATALOG_SPEC}`);
console.log(`  source   ${SOURCE}`);
console.log(`  origins  ${bases.join(', ') || '(none advertised)'}`);
console.log(`  targets  ${targets.length} url(s)`);
console.log('');

if (targets.length === 0) {
  console.log('Nothing to check for this source.');
  console.log('The catalog advertises no mirrors — pass --mirror <base> to stamp one,');
  console.log('or use --source primary to check the primary origin.');
  process.exit(0);
}

const results = await runLimited(targets, CONCURRENCY, checkTarget);

for (const result of results) {
  const label = result.ok ? 'ok  ' : 'FAIL';
  const detail = result.ok
    ? `${result.ms ?? '?'}ms${result.remoteMd5 ? ' md5 ok' : ''}`
    : `${result.verdict}: ${result.reason}`;
  const kind = result.kind === 'primary' ? 'primary' : 'mirror ';
  console.log(
    `  ${label}  ${kind}  ${result.asset.padEnd(12)} ${result.regionId.padEnd(34)} ${detail}`,
  );
}

const failed = results.filter((result) => !result.ok);

if (JSON_OUT) {
  const summary = {
    source: SOURCE,
    catalog: CATALOG_SPEC,
    total: results.length,
    ok: results.length - failed.length,
    failed: failed.map((result) => ({
      regionId: result.regionId,
      asset: result.asset,
      kind: result.kind,
      url: result.url,
      verdict: result.verdict,
      reason: result.reason,
    })),
  };
  try {
    writeFileSync(resolve(JSON_OUT), `${JSON.stringify(summary, null, 2)}\n`);
  } catch (error) {
    console.error(`could not write ${JSON_OUT}: ${error.message}`);
    process.exit(1);
  }
}

const byVerdict = new Map();
for (const result of failed)
  byVerdict.set(result.verdict, (byVerdict.get(result.verdict) ?? 0) + 1);

console.log('');
if (failed.length === 0) {
  console.log(`All ${results.length} ${SOURCE} asset(s) matched the catalog.`);
  process.exit(0);
}

for (const [verdict, count] of byVerdict) {
  console.log(`  ${count}× ${verdict.padEnd(18)} ${VERDICT_HINT[verdict] ?? ''}`);
}
console.log('');
console.log(`${failed.length} of ${results.length} asset(s) failed.`);

// A stale catalog is a publishing-timing problem, not a broken origin: nothing
// needs re-uploading, the catalog needs republishing once the build cycle ends.
if (byVerdict.size === 1 && byVerdict.has('catalog-stale')) {
  console.log('');
  console.log('Every mismatch is catalog staleness — no origin needs fixing. Re-run this');
  console.log('after the build cycle finishes (and after publish-catalog republishes).');
}
if (WARN_ONLY) {
  console.log('(--warn-only: exiting 0)');
  process.exit(0);
}
process.exit(1);
