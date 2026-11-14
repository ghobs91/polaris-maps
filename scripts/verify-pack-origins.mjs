#!/usr/bin/env node
/**
 * Preflight check for the pack origins a release build depends on.
 *
 * Polaris runs no CDN: the offline packs, the region catalog and the signed
 * kill-switch document are all served by third parties (GitHub Releases today).
 * When one of them is not actually published, the app still builds and still
 * runs — it just quietly falls back to live third-party tiles and geocoders for
 * every user, which is the load profile the packs exist to remove.
 *
 * This script answers one question before a build ships: can a fresh install
 * find its data, and can we turn a third-party origin off if it blocks us?
 *
 * Usage:
 *   node scripts/verify-pack-origins.mjs [options]
 *
 * Options:
 *   --catalog <url>     Override EXPO_PUBLIC_REGION_CATALOG_URL
 *   --config <url>      Override EXPO_PUBLIC_REMOTE_CONFIG_URL
 *   --regions <n>       Regions whose assets to probe (default 1)
 *   --timeout <ms>      Per-request timeout (default 15000)
 *   --warn-only         Report failures but exit 0
 *   --help              Show this text
 *
 * Exit codes: 0 all checks passed, 1 any check failed.
 */

import { readFileSync } from 'node:fs';

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

// Same defaults as `src/constants/config.ts` / `remoteConfig.ts`: the pack
// release tag carries the packs, the catalog and the signed config. Kept in
// sync by hand because this script is plain ESM and cannot import the TS
// constants; `packOriginsDefaults.test.ts` pins the three strings together.
const DATA_REPO = process.env.EXPO_PUBLIC_REGION_DATA_REPO ?? 'ghobs91/polaris-maps';
const DATA_TAG = 'map-data-latest';
const DATA_BASE = `https://github.com/${DATA_REPO}/releases/download/${DATA_TAG}`;

const CATALOG_URL =
  flag('--catalog', process.env.EXPO_PUBLIC_REGION_CATALOG_URL ?? '') || `${DATA_BASE}/catalog.json`;
const CONFIG_URL =
  flag('--config', process.env.EXPO_PUBLIC_REMOTE_CONFIG_URL ?? '') || `${DATA_BASE}/config.json`;
const REGIONS = Number(flag('--regions', '1'));
const TIMEOUT_MS = Number(flag('--timeout', '15000'));
const WARN_ONLY = args.includes('--warn-only');

const PLACEHOLDER_HOSTS = ['example.com', 'example.net', 'example.org'];

const results = [];

function record(name, ok, detail, remedy) {
  results.push({ name, ok, detail, remedy });
  const label = ok ? 'ok  ' : 'FAIL';
  console.log(`  ${label}  ${name.padEnd(22)} ${detail}`);
  if (!ok && remedy) {
    for (const line of remedy.split('\n')) console.log(`        ${line}`);
  }
}

function isPlaceholder(url) {
  if (!url) return true;
  try {
    const { hostname } = new URL(url);
    return PLACEHOLDER_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
  } catch {
    return true;
  }
}

async function request(url, init = {}) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
}

async function getJson(url) {
  const res = await request(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) return { ok: false, status: res.status };
  try {
    return { ok: true, body: await res.json() };
  } catch {
    return { ok: false, status: res.status, reason: 'not JSON' };
  }
}

/**
 * Probe an asset without absorbing it: one ranged byte. Some origins refuse
 * HEAD, so this uses a GET that returns at most a single byte.
 */
async function probeAsset(url) {
  const res = await request(url, {
    headers: { Range: 'bytes=0-0', 'User-Agent': 'PolarisMaps/1.0 (+https://app.polarismaps.app)' },
  });
  res.body?.cancel?.();
  return res.status;
}

const CONFIG_REMEDY = [
  'Publish the signed kill-switch document; without it every third-party origin',
  'stays enabled and nothing can be shut off remotely:',
  '  node scripts/sign-remote-config.mjs config.json > signed-config.json',
  '  upload it to the origin named by EXPO_PUBLIC_REMOTE_CONFIG_URL',
].join('\n');

const CATALOG_REMEDY = [
  'No region packs are published, so every install streams live tiles instead',
  'of downloading a pack. Publish one:',
  '  Actions → Build region data (or: bash scripts/generate-region-data.sh)',
  '  then confirm the map-data-<YYYY-MM> release exists and carries catalog.json',
].join('\n');

async function checkRemoteConfig() {
  if (isPlaceholder(CONFIG_URL)) {
    record('remote config', false, 'unset or placeholder origin', CONFIG_REMEDY);
    return;
  }
  try {
    const { ok, status, body, reason } = await getJson(CONFIG_URL);
    if (!ok) {
      record(
        'remote config',
        false,
        `HTTP ${status}${reason ? ` (${reason})` : ''}`,
        CONFIG_REMEDY,
      );
      return;
    }
    const flags = body?.flags;
    const sane =
      flags && typeof flags === 'object' && typeof body?.signature === 'string' && body.signature;
    record(
      'remote config',
      Boolean(sane),
      sane
        ? `signed, ${Object.keys(flags).length} flags`
        : 'reachable but not a signed flag document',
      sane ? null : CONFIG_REMEDY,
    );
    if (sane) {
      const off = Object.entries(flags)
        .filter(([, v]) => v === false)
        .map(([k]) => k);
      console.log(`        disabled by this config: ${off.length > 0 ? off.join(', ') : '(none)'}`);
    }
  } catch (error) {
    record('remote config', false, error.message, CONFIG_REMEDY);
  }
}

async function checkCatalog() {
  if (isPlaceholder(CATALOG_URL)) {
    record('region catalog', false, 'unset or placeholder origin', CATALOG_REMEDY);
    return null;
  }
  try {
    const { ok, status, body, reason } = await getJson(CATALOG_URL);
    if (!ok) {
      record(
        'region catalog',
        false,
        `HTTP ${status}${reason ? ` (${reason})` : ''}`,
        status === 404 ? CATALOG_REMEDY : null,
      );
      return null;
    }
    const regions = Array.isArray(body?.regions) ? body.regions : [];
    record(
      'region catalog',
      regions.length > 0,
      regions.length > 0
        ? `${regions.length} regions, asset tag ${body?.assetTag ?? '(none)'}`
        : 'reachable but lists no regions',
      regions.length > 0 ? null : CATALOG_REMEDY,
    );
    return regions.length > 0 ? body : null;
  } catch (error) {
    record('region catalog', false, error.message, CATALOG_REMEDY);
    return null;
  }
}

const ASSET_FIELDS = ['geocodingUrl', 'placesUrl', 'searchIndexUrl', 'transitIndexUrl'];

/** The first asset a download would actually fetch for this region. */
function firstAssetUrl(region) {
  const asset = Array.isArray(region?.assets) ? region.assets.find((a) => a?.url) : null;
  if (asset?.url) return { label: asset.name ?? 'asset', url: asset.url };
  const field = ASSET_FIELDS.find((name) => typeof region?.[name] === 'string' && region[name]);
  return field ? { label: field, url: region[field] } : null;
}

async function checkAssets(catalog) {
  if (!catalog) return;
  const regions = catalog.regions.slice(0, Math.max(1, REGIONS));

  for (const region of regions) {
    const asset = firstAssetUrl(region);
    if (!asset) {
      record(`pack asset ${region?.id ?? '?'}`, false, 'catalog entry lists no asset URLs');
      continue;
    }
    try {
      const status = await probeAsset(asset.url);
      record(
        `pack asset ${region?.id ?? '?'}`,
        status === 200 || status === 206,
        `${asset.label} → HTTP ${status}`,
        status === 404 ? CATALOG_REMEDY : null,
      );
    } catch (error) {
      record(`pack asset ${region?.id ?? '?'}`, false, `${asset.label} → ${error.message}`);
    }
  }
}

/**
 * OpenFreeMap is the fallback for everything the packs would have covered, and
 * it is donation-funded with no SLA. Recentring here is enough to tell whether
 * the tile origin is reachable at all.
 */
async function checkTileOrigin() {
  try {
    const res = await request('https://tiles.openfreemap.org/planet', {
      headers: { 'User-Agent': 'PolarisMaps/1.0 (+https://app.polarismaps.app)' },
    });
    res.body?.cancel?.();
    record('tile origin', res.ok, `OpenFreeMap → HTTP ${res.status}`);
  } catch (error) {
    record('tile origin', false, `OpenFreeMap → ${error.message}`);
  }
}

console.log('Polaris pack-origin preflight');
console.log(`  config   ${CONFIG_URL}`);
console.log(`  catalog  ${CATALOG_URL || '(unset)'}`);
console.log('');

await checkRemoteConfig();
const catalog = await checkCatalog();
await checkAssets(catalog);
await checkTileOrigin();

const failed = results.filter((r) => !r.ok);
console.log('');
if (failed.length === 0) {
  console.log('All origins resolve.');
  process.exit(0);
}

console.log(`${failed.length} of ${results.length} checks failed.`);
if (WARN_ONLY) {
  console.log('(--warn-only: exiting 0)');
  process.exit(0);
}
process.exit(1);
