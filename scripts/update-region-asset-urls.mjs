#!/usr/bin/env node
/**
 * update-region-asset-urls.mjs
 *
 * Stamps the pack's optional asset URLs (and sizes) into the region catalog
 * after a build has published them.
 *
 * Polaris runs no CDN: `--base` is whatever community/third-party origin serves
 * the packs (a GitHub Releases download prefix by default, matching
 * .github/workflows/build-region-data.yml).
 *
 * Usage:
 *   node scripts/update-region-asset-urls.mjs \
 *     --tag map-data-2026-01 \
 *     [--base https://github.com/OWNER/REPO/releases/download] \
 *     [--sizes sizes.json] \
 *     [--catalog scripts/regions.json] \
 *     [--out catalog.json] \
 *     [--assets assets.json] \
 *     [--dry-run]
 *
 * `sizes.json` maps region id → { searchIndexSizeBytes, transitIndexSizeBytes },
 * as emitted per region by the CI workflow. Missing sizes are simply omitted;
 * every size field is optional in the app's catalog schema.
 *
 * With `--out`, the stamped result is written to that path in the shape the app
 * reads (`{ version, updated_at, regions }`), so a CI job can publish it as a
 * release asset — GitHub is the origin, Polaris runs no CDN.
 *
 * `--assets` takes a JSON array of asset names already present in the release
 * and drops regions whose pack is not there. Without it, a partial build (one
 * region, or a matrix job that failed) would publish a catalog advertising packs
 * that 404.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DEFAULT_BASE = 'https://github.com/ghobs91/polaris-maps/releases/download';
const DEFAULT_CATALOG = 'scripts/regions.json';

function parseArgs(argv) {
  const args = { base: DEFAULT_BASE, catalog: DEFAULT_CATALOG, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--tag') args.tag = argv[++i];
    else if (arg === '--base') args.base = argv[++i];
    else if (arg === '--sizes') args.sizes = argv[++i];
    else if (arg === '--catalog') args.catalog = argv[++i];
    else if (arg === '--out') args.out = argv[++i];
    else if (arg === '--assets') args.assets = argv[++i];
    else if (arg === '--checksums') args.checksums = argv[++i];
    else if (arg === '--mirrors') args.mirrors = argv[++i];
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!args.tag) throw new Error('--tag is required (e.g. map-data-2026-01)');
  return args;
}

/**
 * One manifest entry. `checksums` maps release asset name -> md5; `mirrors`
 * are base URLs that serve the same asset names (community mirrors).
 */
function assetEntry(fileName, releaseName, url, sizeBytes, checksums, mirrors) {
  const entry = { name: fileName, url, gzip: url.endsWith('.gz') };
  if (typeof sizeBytes === 'number') entry.sizeBytes = sizeBytes;
  const md5 = checksums[releaseName];
  if (md5) entry.md5 = String(md5).toLowerCase();
  const mirrorUrls = mirrors
    .map((base) => `${String(base).replace(/\/+$/, '')}/${releaseName}`)
    .filter((u) => u !== url);
  if (mirrorUrls.length > 0) entry.mirrors = mirrorUrls;
  return entry;
}

/** Release asset name for a region's optional index. */
export function assetName(regionId, asset) {
  return `${regionId}-${asset}`;
}

/**
 * Pure transform: given a catalog and the release coordinates, return a new
 * catalog with asset URLs (and sizes, when known) stamped in.
 */
export function stampCatalog(catalog, { tag, base, sizes = {}, checksums = {}, mirrors = [] }) {
  const prefix = `${base.replace(/\/+$/, '')}/${tag}`;
  const regions = (catalog.regions ?? catalog.include ?? []).map((region) => {
    const size = sizes[region.id] ?? {};
    const searchName = assetName(region.id, 'search.sqlite');
    const transitName = assetName(region.id, 'transit.sqlite');
    const stamped = {
      ...region,
      searchIndexUrl: `${prefix}/${searchName}`,
      transitIndexUrl: `${prefix}/${transitName}`,
    };
    if (typeof size.searchIndexSizeBytes === 'number') {
      stamped.searchIndexSizeBytes = size.searchIndexSizeBytes;
    }
    if (typeof size.transitIndexSizeBytes === 'number') {
      stamped.transitIndexSizeBytes = size.transitIndexSizeBytes;
    }
    // Per-asset manifest: enables resumable + mirror-aware + delta downloads
    // on the client (checksum/size let an unchanged asset be skipped).
    const tilesName = assetName(region.id, 'tiles.pmtiles');
    stamped.assets = [
      // Base-map archive: when present the client expands it locally instead
      // of pulling tiles from the shared OpenFreeMap servers.
      assetEntry(
        'tiles.pmtiles',
        tilesName,
        `${prefix}/${tilesName}`,
        size.tilesSizeBytes,
        checksums,
        mirrors,
      ),
      assetEntry(
        'search.sqlite',
        searchName,
        `${prefix}/${searchName}`,
        size.searchIndexSizeBytes,
        checksums,
        mirrors,
      ),
      assetEntry(
        'transit.sqlite',
        transitName,
        `${prefix}/${transitName}`,
        size.transitIndexSizeBytes,
        checksums,
        mirrors,
      ),
    ];
    return stamped;
  });

  // Preserve the catalog's own top-level shape (some catalogs use `include`
  // for the CI matrix and `regions` for the app).
  if (Array.isArray(catalog.include)) return { ...catalog, include: regions };
  return { ...catalog, regions };
}

/**
 * Shape the app reads (`catalogService.CatalogManifest`): `regions`, not the CI
 * matrix's `include`.
 *
 * `assets` (asset names present in the release) filters out regions whose pack
 * was not built, so a partial run cannot advertise a pack that 404s.
 */
export function toPublishedCatalog(stamped, assets = null) {
  let regions = stamped.regions ?? stamped.include ?? [];
  if (assets) {
    const present = new Set(assets);
    regions = regions.filter((region) => present.has(`${region.id}-routing.tar`));
  }
  return {
    version: '1',
    updated_at: new Date().toISOString(),
    regions,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const catalogPath = resolve(args.catalog);
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
  const sizes = args.sizes ? JSON.parse(readFileSync(resolve(args.sizes), 'utf8')) : {};
  const checksums = args.checksums
    ? JSON.parse(readFileSync(resolve(args.checksums), 'utf8'))
    : {};
  const mirrors = args.mirrors ? args.mirrors.split(',').map((m) => m.trim()).filter(Boolean) : [];

  const assets = args.assets
    ? JSON.parse(readFileSync(resolve(args.assets), 'utf8'))
    : null;
  const stamped = stampCatalog(catalog, {
    tag: args.tag,
    base: args.base,
    sizes,
    checksums,
    mirrors,
  });
  const updated = args.out ? toPublishedCatalog(stamped, assets) : stamped;
  const serialised = `${JSON.stringify(updated, null, 2)}\n`;

  if (args.dryRun) {
    process.stdout.write(serialised);
    return 0;
  }

  const target = args.out ? resolve(args.out) : catalogPath;
  writeFileSync(target, serialised);
  const count = (updated.regions ?? updated.include ?? []).length;
  process.stderr.write(`stamped ${count} regions with ${args.tag} asset URLs → ${target}\n`);
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith('update-region-asset-urls.mjs')) {
  process.exit(main());
}
