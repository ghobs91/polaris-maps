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
 *     [--dry-run]
 *
 * `sizes.json` maps region id → { searchIndexSizeBytes, transitIndexSizeBytes },
 * as emitted per region by the CI workflow. Missing sizes are simply omitted;
 * every size field is optional in the app's catalog schema.
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
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!args.tag) throw new Error('--tag is required (e.g. map-data-2026-01)');
  return args;
}

/** Release asset name for a region's optional index. */
export function assetName(regionId, asset) {
  return `${regionId}-${asset}`;
}

/**
 * Pure transform: given a catalog and the release coordinates, return a new
 * catalog with asset URLs (and sizes, when known) stamped in.
 */
export function stampCatalog(catalog, { tag, base, sizes = {} }) {
  const prefix = `${base.replace(/\/+$/, '')}/${tag}`;
  const regions = (catalog.regions ?? catalog.include ?? []).map((region) => {
    const size = sizes[region.id] ?? {};
    const stamped = {
      ...region,
      searchIndexUrl: `${prefix}/${assetName(region.id, 'search.sqlite')}`,
      transitIndexUrl: `${prefix}/${assetName(region.id, 'transit.sqlite')}`,
    };
    if (typeof size.searchIndexSizeBytes === 'number') {
      stamped.searchIndexSizeBytes = size.searchIndexSizeBytes;
    }
    if (typeof size.transitIndexSizeBytes === 'number') {
      stamped.transitIndexSizeBytes = size.transitIndexSizeBytes;
    }
    return stamped;
  });

  // Preserve the catalog's own top-level shape (some catalogs use `include`
  // for the CI matrix and `regions` for the app).
  if (Array.isArray(catalog.include)) return { ...catalog, include: regions };
  return { ...catalog, regions };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const catalogPath = resolve(args.catalog);
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
  const sizes = args.sizes ? JSON.parse(readFileSync(resolve(args.sizes), 'utf8')) : {};

  const updated = stampCatalog(catalog, { tag: args.tag, base: args.base, sizes });
  const serialised = `${JSON.stringify(updated, null, 2)}\n`;

  if (args.dryRun) {
    process.stdout.write(serialised);
    return 0;
  }

  writeFileSync(catalogPath, serialised);
  const count = (updated.regions ?? updated.include ?? []).length;
  process.stderr.write(`stamped ${count} regions with ${args.tag} asset URLs\n`);
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith('update-region-asset-urls.mjs')) {
  process.exit(main());
}
