#!/usr/bin/env node
/**
 * Verify every catalog region against Geofabrik's own index before building.
 *
 * Two whole CI runs were lost to regions whose extract does not exist: the
 * Geofabrik tree carried paths like `africa/congo-kinshasa` (Geofabrik publishes
 * `africa/congo-democratic-republic`) and leaves for countries it does not
 * publish at all (Comoros, Western Sahara, Oman, San Marino). Each one failed
 * its download step minutes in, and the run was reported as a failure without
 * saying which of ~200 regions was at fault.
 *
 * `index-v1.json` is Geofabrik's machine-readable catalogue: every feature has
 * an `id`, a `parent`, and the real `urls.pbf`. The download URL is compared
 * against `urls.pbf` itself, not a path rebuilt from `parent` links: Geofabrik
 * serves each extract from a directory named after it
 * (`europe/france/alsace/alsace-latest.osm.pbf`), so a catalogue entry can name
 * a directory that exists while the file inside it does not. Rebuilding paths
 * from the tree hid 138 dead catalog entries for exactly that reason.
 *
 *   node scripts/verify-geofabrik-paths.mjs                 # check the catalog
 *   node scripts/verify-geofabrik-paths.mjs --sizes         # also flag >2 GiB
 *   node scripts/verify-geofabrik-paths.mjs --index i.json  # offline
 *   node scripts/verify-geofabrik-paths.mjs --catalog c.json # other catalog
 *
 * Exit codes: 0 all good, 1 problems found.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const INDEX_URL = 'https://download.geofabrik.de/index-v1.json';
/** GitHub release assets are capped at 2 GiB per file. */
const RELEASE_ASSET_LIMIT_BYTES = 2 * 1024 * 1024 * 1024;

const ROOT = resolve(import.meta.dirname, '..');

/**
 * Every extract Geofabrik publishes, as the path of the file it serves.
 *
 * `https://download.geofabrik.de/africa/algeria/algeria-latest.osm.pbf`
 *   → `africa/algeria/algeria`
 */
export function publishedPaths(index) {
  const paths = new Set();
  for (const feature of index.features) {
    const path = pathOfUrl(feature.properties?.urls?.pbf);
    if (path) paths.add(path);
  }
  return paths;
}

/** Catalog regions whose Geofabrik extract is not published. */
export function unpublishedRegions(regions, published) {
  const problems = [];
  for (const region of regions) {
    const path = pathOfUrl(region.geofabrik);
    if (!path) continue; // custom URL, nothing to verify
    if (!published.has(path)) problems.push({ id: region.id, path });
  }
  return problems;
}

/**
 * `https://download.geofabrik.de/australia-oceania/australia/australia-latest.osm.pbf`
 *   → `australia-oceania/australia/australia`
 *
 * The legacy flat form (`.../australia-oceania/australia-latest.osm.pbf`)
 * reduces to `australia-oceania/australia`, which no published extract matches —
 * that is the point, those URLs 404.
 */
export function pathOfUrl(url) {
  const match = /^https:\/\/download\.geofabrik\.de\/(.+)\.osm\.pbf$/.exec(url ?? '');
  if (!match) return null;
  return match[1].replace(/-latest$/, '');
}

async function sizeOf(url) {
  const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
  const length = Number(res.headers.get('content-length') ?? 0);
  return Number.isFinite(length) ? length : 0;
}

async function main() {
  const checkSizes = process.argv.includes('--sizes');
  // `--catalog` lets the check run against a fixture; the default is the
  // committed catalog the build reads.
  const catalogFlag = process.argv.indexOf('--catalog');
  const catalogPath =
    catalogFlag !== -1 ? process.argv[catalogFlag + 1] : resolve(ROOT, 'scripts/regions.json');
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));

  // `--index` reads a saved index instead of the network, so the check is
  // testable and usable offline.
  const indexFlag = process.argv.indexOf('--index');
  let index;
  if (indexFlag !== -1) {
    index = JSON.parse(readFileSync(process.argv[indexFlag + 1], 'utf8'));
  } else {
    const res = await fetch(INDEX_URL);
    if (!res.ok) {
      console.error(`could not read the Geofabrik index: HTTP ${res.status}`);
      return 1;
    }
    index = await res.json();
  }
  const published = publishedPaths(index);

  let failed = false;
  const unpublished = unpublishedRegions(catalog.include, published);
  if (unpublished.length > 0) {
    failed = true;
    console.error(`${unpublished.length} catalog regions are not published by Geofabrik:`);
    for (const { id, path } of unpublished) console.error(`  ${id} → ${path}`);
    console.error('Fix the path in src/constants/geofabrikCatalog.ts, or drop the region.');
  }

  if (checkSizes) {
    const oversized = [];
    for (const region of catalog.include) {
      const path = pathOfUrl(region.geofabrik);
      if (!path) continue;
      const bytes = await sizeOf(region.geofabrik);
      if (bytes > RELEASE_ASSET_LIMIT_BYTES) {
        oversized.push({ id: region.id, mb: Math.round(bytes / 1048576) });
      }
    }
    if (oversized.length > 0) {
      failed = true;
      console.error(`${oversized.length} catalog regions exceed the 2 GiB release-asset cap:`);
      for (const { id, mb } of oversized) console.error(`  ${id} (${mb} MB)`);
      console.error('Add them to DENYLIST in scripts/generate-pack-catalog.mjs.');
    }
  }

  if (failed) return 1;
  console.log(
    `all ${catalog.include.length} catalog regions resolve on Geofabrik` +
      (checkSizes ? ' and fit the release cap' : ''),
  );
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith('verify-geofabrik-paths.mjs')) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(`verify-geofabrik-paths: ${error.message}`);
      process.exit(1);
    },
  );
}
