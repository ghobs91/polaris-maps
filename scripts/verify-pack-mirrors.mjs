#!/usr/bin/env node
/**
 * Verify that every pack mirror the catalog advertises actually serves the bytes.
 *
 * The catalog is the only place the app learns about mirrors: each asset carries
 * its alternates in `assets[].mirrors`, and `assetBaseUrls` covers the routing
 * tarballs, which are not listed per asset. A mirror that is uploaded but not
 * listed is never used; a mirror that is listed but not uploaded turns into a
 * failed transfer on every device that rotates onto it (and, because
 * `mirrorHealth` demotes on failure, a burst of them at launch).
 *
 * So this runs after mirroring and before the catalog is published:
 *
 *   - every advertised URL must answer a one-byte ranged GET (206, or 200 with
 *     the whole body available) and report the size the catalog expects;
 *   - on the Internet Archive, the item's own md5 for the file must match the
 *     catalog's md5 — the cheap, authoritative cross-check, without downloading
 *     27 GB to hash it locally.
 *
 * Usage:
 *   node scripts/verify-pack-mirrors.mjs [options]
 *
 * Options:
 *   --catalog <path|url>  Catalog to check (default: the published one)
 *   --mirror <base>       Only check URLs under this base (repeatable)
 *   --assets <names>      Comma-separated asset names to check (default: all)
 *   --regions <n>         Check the first n regions (default: all)
 *   --concurrency <n>     Parallel probes (default 4)
 *   --timeout <ms>        Per-request timeout (default 20000)
 *   --warn-only           Report failures but exit 0
 *   --help                Show this text
 *
 * Exit codes: 0 every advertised mirror asset resolved, 1 any did not.
 */

import { readFileSync } from 'node:fs';
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
const MIRROR_FILTERS = flags('--mirror');
const ASSET_FILTER = flag('--assets', '')
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean);
const REGION_LIMIT = Number(flag('--regions', '0'));
const CONCURRENCY = Math.max(1, Number(flag('--concurrency', '4')));
const TIMEOUT_MS = Number(flag('--timeout', '20000'));
const WARN_ONLY = args.includes('--warn-only');

const USER_AGENT = 'PolarisMaps/1.0 (+https://app.polarismaps.app)';

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

/** Every (region, asset, url) the catalog advertises, mirrors only. */
function collectTargets(catalog) {
  const regions = (catalog.regions ?? catalog.include ?? []).slice(
    0,
    REGION_LIMIT > 0 ? REGION_LIMIT : undefined,
  );
  const targets = [];

  for (const region of regions) {
    for (const asset of region.assets ?? []) {
      if (ASSET_FILTER.length > 0 && !ASSET_FILTER.includes(asset.name)) continue;
      for (const mirror of asset.mirrors ?? []) {
        targets.push({
          regionId: region.id,
          asset: asset.name,
          url: mirror,
          sizeBytes: asset.sizeBytes,
          md5: asset.md5 ? String(asset.md5).toLowerCase() : undefined,
          primary: false,
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
        targets.push({ regionId: region.id, asset: 'routing.tar', url, primary: false });
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

async function checkTarget(target) {
  try {
    const probeResult = await probe(target.url);
    // The Internet Archive answers a missing item with 503 (not 404), and a
    // darked item with 403, so "not there" is wider than one status code.
    if ([403, 404, 410, 503].includes(probeResult.status)) {
      return {
        ...target,
        ok: false,
        reason: `not served (HTTP ${probeResult.status}) — item missing, dark, or still ingesting`,
      };
    }
    if (![200, 206].includes(probeResult.status)) {
      return { ...target, ok: false, reason: `HTTP ${probeResult.status}` };
    }
    if (
      probeResult.size != null &&
      target.sizeBytes != null &&
      probeResult.size !== target.sizeBytes
    ) {
      return {
        ...target,
        ok: false,
        reason: `size ${probeResult.size} ≠ catalog ${target.sizeBytes}`,
      };
    }
    if (probeResult.acceptRanges && probeResult.acceptRanges !== 'bytes') {
      return { ...target, ok: false, reason: `Accept-Ranges: ${probeResult.acceptRanges}` };
    }

    // A truncated or wrong object that happens to have the right size is
    // exactly what a resumable client cannot detect on its own, so the md5 is
    // checked wherever the origin can report one.
    const remoteMd5 = await iaMd5(target.url);
    if (remoteMd5 && target.md5 && remoteMd5 !== target.md5) {
      return { ...target, ok: false, reason: `md5 ${remoteMd5} ≠ catalog ${target.md5}` };
    }
    return { ...target, ok: true, remoteMd5: remoteMd5 ?? undefined, ms: probeResult.ms };
  } catch (error) {
    return { ...target, ok: false, reason: error instanceof Error ? error.message : 'failed' };
  }
}

let catalog;
try {
  catalog = await loadCatalog(CATALOG_SPEC);
} catch (error) {
  console.error(`Could not load catalog ${CATALOG_SPEC}: ${error.message}`);
  process.exit(1);
}

const targets = collectTargets(catalog);
const bases = [...new Set(targets.map((target) => new URL(target.url).origin))];

console.log('Polaris pack-mirror verification');
console.log(`  catalog  ${CATALOG_SPEC}`);
console.log(`  mirrors  ${bases.join(', ') || '(none advertised — nothing to check)'}`);
console.log(`  targets  ${targets.length} url(s)`);
console.log('');

if (targets.length === 0) {
  console.log('The catalog advertises no mirrors. Pass --mirror <base> to stamp one,');
  console.log('or check that `update-region-asset-urls.mjs --mirror` was used.');
  process.exit(0);
}

const results = await runLimited(targets, CONCURRENCY, checkTarget);

for (const result of results) {
  const label = result.ok ? 'ok  ' : 'FAIL';
  const detail = result.ok
    ? `${result.ms ?? '?'}ms${result.remoteMd5 ? ' md5 ok' : ''}`
    : result.reason;
  console.log(`  ${label}  ${result.asset.padEnd(12)} ${result.regionId.padEnd(34)} ${detail}`);
}

const failed = results.filter((result) => !result.ok);
console.log('');
if (failed.length === 0) {
  console.log(`All ${results.length} advertised mirror assets resolved.`);
  process.exit(0);
}

// Group by reason so a wrong tag shows up as one line, not 355.
const byReason = new Map();
for (const result of failed) {
  const key = result.reason.replace(/\d+/g, 'N');
  byReason.set(key, (byReason.get(key) ?? 0) + 1);
}
for (const [reason, count] of byReason) {
  console.log(`  ${count}× ${reason}`);
}
console.log('');
console.log(`${failed.length} of ${results.length} mirror assets failed.`);
console.log('Do not publish the catalog until these resolve: a listed mirror that');
console.log('404s is a failed transfer on every device that rotates onto it.');
if (WARN_ONLY) {
  console.log('(--warn-only: exiting 0)');
  process.exit(0);
}
process.exit(1);
