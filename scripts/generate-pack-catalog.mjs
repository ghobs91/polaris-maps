#!/usr/bin/env node
/**
 * generate-pack-catalog.mjs — extend `scripts/regions.json` to full world
 * parity with the Geofabrik tree.
 *
 * The app ships two region sources that were previously unrelated:
 *
 *   - `scripts/regions.json`: 39 curated metro packs, built by CI, carrying
 *     per-asset pack manifests.
 *   - `src/constants/geofabrikCatalog.ts`: ~200 downloadable areas worldwide
 *     (the tree in the regions UI), which build no pack at all — they download
 *     as OpenFreeMap tiles and are capped at 50 MB per download.
 *
 * This emits one catalog entry per tree leaf, so every area the UI offers can
 * be a pack. Key property: the generated id is the tree path with `/` → `-`,
 * which is exactly `geoNodeToRegion(node).id` — so the regions UI can look a
 * pack up by the id it already has, and auto-download picks the smallest pack
 * covering the user.
 *
 * Curated entries win on conflict: the 39 metros have hand-tuned bounds,
 * feed mappings and an existing release history.
 *
 * Usage:
 *   node scripts/generate-pack-catalog.mjs [--check]
 *
 *   --check  exit 1 if scripts/regions.json is not already up to date
 *            (used by CI/tests; writes nothing)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TREE_PATH = resolve('src/constants/geofabrikCatalog.ts');
const REGIONS_PATH = resolve('scripts/regions.json');
/** Hand-maintained metro entries — the only entries the tree does not produce. */
const CURATED_PATH = resolve('scripts/regions.curated.json');

/**
 * Evaluate the tree literal from its TypeScript source.
 *
 * The file is pure data (object literals + comments) between
 * `export const GEOFABRIK_TREE: GeoNode[] = [` and the closing `];` — no
 * helper calls — so the literal is valid JavaScript on its own. `new Function`
 * parses it with real JS semantics, which regex-to-JSON conversion would not
 * survive (the data contains apostrophes: Côte d'Ivoire).
 */
function loadTree() {
  const source = readFileSync(TREE_PATH, 'utf8');
  const start = source.indexOf('GEOFABRIK_TREE: GeoNode[] = [');
  if (start === -1) throw new Error('GEOFABRIK_TREE not found in ' + TREE_PATH);
  const literalStart = source.indexOf('[', start);
  const literalEnd = source.indexOf('\n];', literalStart);
  if (literalEnd === -1) throw new Error('tree literal not terminated');
  const literal = source.slice(literalStart, literalEnd + 2);
  return new Function(`return ${literal};`)();
}

/**
 * Leaves of the tree: nodes with bounds and no children.
 *
 * A node with children is decomposed by those children (a country split into
 * states), so a pack for the parent would duplicate them at greater size —
 * skip it and generate for the children.
 */
function collectLeaves(nodes, out = []) {
  for (const node of nodes) {
    if (node.children && node.children.length > 0) {
      collectLeaves(node.children, out);
    } else if (node.bounds) {
      out.push(node);
    }
  }
  return out;
}

function round(n) {
  return Math.round(n * 10000) / 10000;
}

/** Last segment of a tree path: `europe/france/alsace` → `alsace`. */
function leafSegment(path) {
  return path.split('/').pop();
}

/**
 * Download URL for a tree path.
 *
 * Geofabrik publishes every extract inside a directory named after it:
 * `.../europe/france/alsace/alsace-latest.osm.pbf`. The flat form
 * (`.../europe/france/alsace-latest.osm.pbf`) still redirects correctly for
 * continent-level files, but 404s for every nested one — the redirect drops the
 * continent (`.../france/alsace/alsace-latest.osm.pbf`). 138 catalog entries
 * were dead before this was pinned, all of them nested.
 */
export function geofabrikUrl(path) {
  return `https://download.geofabrik.de/${path}/${leafSegment(path)}-latest.osm.pbf`;
}

/** One catalog entry from a tree leaf, in `regions.json`'s shape. */
function entryForLeaf(leaf) {
  const { minLat, maxLat, minLng, maxLng } = leaf.bounds;
  return {
    id: leaf.path.replace(/\//g, '-'),
    name: leaf.name,
    // The build clips the Geofabrik extract to the region's own bounds, which
    // for a leaf is (near-)identity — kept so the matrix stays uniform.
    bbox: `${round(minLng)},${round(minLat)},${round(maxLng)},${round(maxLat)}`,
    // The app reads `bounds`, not `bbox`, and stores it in NOT NULL columns:
    // a region without them cannot be seeded at all. `bbox` alone is only
    // enough for the CI matrix.
    bounds: { minLat, maxLat, minLng, maxLng },
    geofabrik: geofabrikUrl(leaf.path),
  };
}

/**
 * Tree leaves whose Geofabrik extract is an entire large country.
 *
 * A pack for one of these is a multi-gigabyte archive: it would blow the
 * per-file release cap, push a standard 16 GB CI runner past its disk, and ask
 * a phone to auto-download a gigabyte. The UI still lists them (they mirror
 * Geofabrik's own hierarchy); they simply stay on the tile path, same as
 * today. Revisit per-region if Geofabrik splits them or a build strategy for
 * split archives appears.
 */
const DENYLIST = new Set([
  'antarctica',
  'asia-china',
  'south-america-brazil',
  'australia-oceania-australia',
  'asia-india',
  'asia-indonesia',
  // Japan's extract is 2.57 GB, past GitHub's 2 GiB per-asset release cap, so
  // the release upload fails and takes the whole job with it.
  'asia-japan',
]);

function generate() {
  const tree = loadTree();
  const leaves = collectLeaves(tree);

  // Curated entries have their own file. Reading them out of the generated
  // file made "is this hand-written?" a guess, and the guess (everything
  // already present) froze generated entries and kept regions the tree no
  // longer produces.
  const curatedFile = JSON.parse(readFileSync(CURATED_PATH, 'utf8'));
  const curated = new Map(curatedFile.include.map((entry) => [entry.id, entry]));

  // Cross-listed nodes (Russia is intentionally under Europe AND top-level,
  // mirroring Geofabrik's site) must yield one matrix job, not two colliding
  // on the same asset names — dedupe by id, first occurrence wins.
  const seen = new Set();
  const generated = [];
  for (const leaf of leaves) {
    const entry = entryForLeaf(leaf);
    if (curated.has(entry.id) || seen.has(entry.id) || DENYLIST.has(entry.id)) continue;
    seen.add(entry.id);
    generated.push(entry);
  }

  // Curated first (the gtfs-coverage test relies on that ordering), then the
  // tree in its own order, so the file stays stable and diffable.
  const include = [...curated.values(), ...generated];

  return {
    comment: [
      'Canonical catalog of regions built by CI and seeded in the app.',
      'Generated + curated: the metro entries below are hand-maintained (better',
      'bounds, GTFS feeds, release history); the rest are generated from the',
      'Geofabrik tree by scripts/generate-pack-catalog.mjs — re-run that after',
      'editing src/constants/geofabrikCatalog.ts.',
    ],
    include,
    generatedCount: generated.length,
    curatedCount: curated.size,
  };
}

function main() {
  const check = process.argv.includes('--check');
  const next = generate();

  if (check) {
    const current = JSON.parse(readFileSync(REGIONS_PATH, 'utf8'));
    // Compare the whole entry, not just ids: a field the generator stopped (or
    // started) emitting — `bounds`, say — leaves the ids identical while the
    // published catalog becomes unseedable.
    const normalise = (entries) =>
      JSON.stringify(
        [...entries].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      );
    if (normalise(current.include) !== normalise(next.include)) {
      console.error(
        `regions.json is stale: tree has ${next.include.length} regions, ` +
          `regions.json has ${current.include.length}. Re-run ` +
          `scripts/generate-pack-catalog.mjs.`,
      );
      return 1;
    }
    console.log(`regions.json is current (${next.include.length} regions)`);
    return 0;
  }

  writeFileSync(REGIONS_PATH, `${JSON.stringify(next, null, 2)}\n`);
  console.log(
    `regions.json: ${next.include.length} regions ` +
      `(${next.curatedCount} curated + ${next.generatedCount} generated from the Geofabrik tree)`,
  );
  return 0;
}

process.exit(main());
