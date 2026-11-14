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
  args.mirrorBases = [];
  args.mirrors = [];
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
    else if (arg === '--asset-sizes') args.assetSizes = argv[++i];
    else if (arg === '--tags') args.tags = argv[++i];
    else if (arg === '--mirrors') {
      // Backwards compatible: a comma-separated list of base URLs.
      for (const base of String(argv[++i]).split(',')) {
        const trimmed = base.trim();
        if (trimmed) args.mirrorBases.push(trimmed);
      }
    } else if (arg === '--mirror') {
      // Repeatable, optionally labelled: --mirror r2=https://...
      const spec = String(argv[++i]).trim();
      const eq = spec.indexOf('=');
      const name = eq === -1 ? `mirror-${args.mirrorBases.length + 1}` : spec.slice(0, eq);
      const base = eq === -1 ? spec : spec.slice(eq + 1);
      if (base.trim()) {
        args.mirrorBases.push(base.trim());
        args.mirrors.push({ name, base: base.trim() });
      }
    } else throw new Error(`unknown argument: ${arg}`);
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
export function stampCatalog(
  catalog,
  {
    tag,
    base,
    sizes = {},
    checksums = {},
    mirrors = [],
    assetSizes = {},
    available = null,
    tags = null,
  },
) {
  // Packs can be split across sibling tags (`map-data-2026-11-a`, …) because a
  // release holds at most 1,000 assets and full-world parity is ~2,500. `tags`
  // maps region id → its tag; `tag` alone stamps every region with the same
  // one. Mirrors follow whatever tag each region landed on.
  const tagFor = (regionId) => (tags ? (tags[regionId] ?? tag) : tag);
  const regions = (catalog.regions ?? catalog.include ?? []).map((region) => {
    const prefix = `${base.replace(/\/+$/, '')}/${tagFor(region.id)}`;
    const mirrorPrefixes = mirrors.map(
      (mirror) => `${String(mirror).replace(/\/+$/, '')}/${tagFor(region.id)}`,
    );
    const size = sizes[region.id] ?? {};
    const searchName = assetName(region.id, 'search.sqlite');
    const transitName = assetName(region.id, 'transit.sqlite');
    const timetableName = assetName(region.id, 'transit-timetable.sqlite');
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
        mirrorPrefixes,
      ),
      assetEntry(
        'search.sqlite',
        searchName,
        `${prefix}/${searchName}`,
        size.searchIndexSizeBytes,
        checksums,
        mirrorPrefixes,
      ),
      assetEntry(
        'transit.sqlite',
        transitName,
        `${prefix}/${transitName}`,
        size.transitIndexSizeBytes,
        checksums,
        mirrorPrefixes,
      ),
      // Scheduled timetable (connections). Optional: a region only lists it when
      // the pack builder could produce one. Large enough that it is its own
      // asset — see services/transit/transitTimetable.ts for why.
      assetEntry(
        'transit-timetable.sqlite',
        timetableName,
        `${prefix}/${timetableName}`,
        size.timetableSizeBytes,
        checksums,
        mirrorPrefixes,
      ),
    ];

    // Prefer the release's own byte size for each asset: `sizes.json` only
    // covers three of the four, and the app's disk gate needs a size for
    // whichever asset it is about to fetch. Without sizes auto-download skips
    // with `size-unknown` and never starts.
    for (const entry of stamped.assets) {
      if (typeof entry.sizeBytes === 'number') continue;
      const fromRelease = assetSizes[assetName(region.id, entry.name)];
      if (typeof fromRelease === 'number') entry.sizeBytes = fromRelease;
    }

    // Drop entries the release does not actually carry, so the catalog never
    // advertises a URL that 404s (a region without a timetable, say).
    if (available) {
      stamped.assets = stamped.assets.filter((entry) =>
        available.has(assetName(region.id, entry.name)),
      );
    }

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
/**
 * `minLng,minLat,maxLng,maxLat` (the CI matrix's form) → the app's bounds object.
 *
 * Returns undefined for a missing or unparseable bbox so the caller's fallback
 * stays explicit rather than producing a region with NaN corners.
 */
export function boundsFromBbox(bbox) {
  if (typeof bbox !== 'string') return undefined;
  const parts = bbox.split(',').map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((value) => !Number.isFinite(value))) return undefined;
  const [minLng, minLat, maxLng, maxLat] = parts;
  return { minLat, maxLat, minLng, maxLng };
}

export function toPublishedCatalog(stamped, assets = null, { tag = null, baseUrls = [] } = {}) {
  let regions = stamped.regions ?? stamped.include ?? [];
  if (assets) {
    const present = new Set(assets);
    regions = regions.filter((region) => present.has(`${region.id}-routing.tar`));
  }
  const catalog = {
    version: '1',
    updated_at: new Date().toISOString(),
    regions: regions.map((region) => ({
      // Every region needs its own `version`. The app's `regions.version` column
      // is NOT NULL, so a catalog without per-region versions throws on the
      // first row and seeds *nothing* — no pack is ever offered, auto-download
      // reports `no-region` forever, and the failure is silent because seeding
      // is best-effort. The publication tag is the content version: it changes
      // with every data refresh, which is what staleness detection compares.
      ...region,
      version: region.version ?? tag ?? '1',
      // `bbox` is what the CI matrix consumes; the app reads `bounds` and
      // stores it in NOT NULL columns. Deriving it here means a hand-written or
      // generated entry that only carries `bbox` still seeds instead of being
      // dropped as malformed.
      bounds: region.bounds ?? boundsFromBbox(region.bbox),
    })),
  };
  // Multi-origin publication metadata. `assetBaseUrls` lets the client build a
  // URL for any release asset (including the routing tarballs, which are not
  // listed in the per-asset manifest) against every origin, and `assetTag`
  // means it can do so without asking the GitHub API for the current tag.
  if (tag) catalog.assetTag = tag;
  if (baseUrls.length > 0) catalog.assetBaseUrls = baseUrls;
  return catalog;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const catalogPath = resolve(args.catalog);
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
  const sizes = args.sizes ? JSON.parse(readFileSync(resolve(args.sizes), 'utf8')) : {};
  const checksums = args.checksums ? JSON.parse(readFileSync(resolve(args.checksums), 'utf8')) : {};
  const mirrors = args.mirrorBases;

  const assets = args.assets ? JSON.parse(readFileSync(resolve(args.assets), 'utf8')) : null;
  // `--asset-sizes` maps release asset name -> bytes, straight from
  // `gh release view --json assets`. It is what gives the app a size for the
  // asset it is about to fetch; without it auto-download skips `size-unknown`.
  const assetSizes = args.assetSizes
    ? JSON.parse(readFileSync(resolve(args.assetSizes), 'utf8'))
    : {};
  const tags = args.tags ? JSON.parse(readFileSync(resolve(args.tags), 'utf8')) : null;
  const stamped = stampCatalog(catalog, {
    tag: args.tag,
    base: args.base,
    sizes,
    checksums,
    mirrors,
    assetSizes,
    available: assets ? new Set(assets) : null,
    tags,
  });
  const baseUrls = [args.base, ...mirrors].map((base) => String(base).replace(/\/+$/, ''));
  const updated = args.out
    ? toPublishedCatalog(stamped, assets, { tag: args.tag, baseUrls })
    : stamped;
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
