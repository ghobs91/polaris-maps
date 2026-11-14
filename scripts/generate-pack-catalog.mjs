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
    geofabrik: `https://download.geofabrik.de/${leaf.path}-latest.osm.pbf`,
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
]);

function generate() {
  const tree = loadTree();
  const leaves = collectLeaves(tree);

  const existing = JSON.parse(readFileSync(REGIONS_PATH, 'utf8'));

  // A tree-leaf id is *generated*, never curated — even though a previous run
  // wrote it into this file. Treating every existing entry as curated freezes
  // generated ones forever, so a field added to `entryForLeaf` later never
  // reaches them. That is exactly how 324 regions shipped with no `bounds`:
  // the app stores bounds in NOT NULL columns, so those regions could not be
  // seeded at all. Only ids the tree does not produce are hand-maintained.
  const leafIds = new Set(leaves.map((leaf) => leaf.path.replace(/\//g, '-')));
  const curated = new Map(
    existing.include
      .filter((entry) => !leafIds.has(entry.id))
      .map((entry) => [entry.id, entry]),
  );

  // Cross-listed nodes (Russia is intentionally under Europe AND top-level,
  // mirroring Geofabrik's site) must yield one matrix job, not two colliding
  // on the same asset names — dedupe by id, first occurrence wins.
  const seen = new Set();
  const generatedById = new Map();
  const generatedOrder = [];
  for (const leaf of leaves) {
    const entry = entryForLeaf(leaf);
    if (curated.has(entry.id) || seen.has(entry.id) || DENYLIST.has(entry.id)) continue;
    seen.add(entry.id);
    generatedById.set(entry.id, entry);
    generatedOrder.push(entry.id);
  }

  // Keep the existing order so diffs stay small, but replace every generated
  // entry with its freshly derived form. Anything new is appended in tree order.
  const include = existing.include.map((entry) =>
    generatedById.has(entry.id) ? generatedById.get(entry.id) : entry,
  );
  const present = new Set(include.map((entry) => entry.id));
  for (const id of generatedOrder) {
    if (!present.has(id)) include.push(generatedById.get(id));
  }

  return {
    comment: [
      'Canonical catalog of regions built by CI and seeded in the app.',
      'Generated + curated: the metro entries below are hand-maintained (better',
      'bounds, GTFS feeds, release history); the rest are generated from the',
      'Geofabrik tree by scripts/generate-pack-catalog.mjs — re-run that after',
      'editing src/constants/geofabrikCatalog.ts.',
    ],
    include,
    generatedCount: generatedById.size,
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
