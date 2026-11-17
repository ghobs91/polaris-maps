#!/usr/bin/env node
/**
 * Re-mirror regions whose upload to a secondary origin failed.
 *
 * A region whose mirror step failed is still complete and correct on GitHub
 * Releases — only the mirror copy is missing. Rebuilding it to retry the upload
 * spends planetiler, Valhalla and the timetable build again (20–50 minutes a
 * region) to produce bytes the release already holds. This pulls the published
 * assets back down and re-runs the upload, which takes seconds to minutes.
 *
 * Usage:
 *   node scripts/remirror-regions.mjs --regions us-ny-new-york,ar-buenos-aires
 *   node scripts/remirror-regions.mjs --regions-file failed.json
 *   node scripts/remirror-regions.mjs --regions-file failed.json --dry-run
 *
 * Options:
 *   --regions <ids>       Comma-separated region ids
 *   --regions-file <path> JSON array of region ids (e.g. a verifier summary)
 *   --catalog <path|url>  Catalog to resolve tags and assets from
 *   --repo <owner/name>   Release repository (default EXPO_PUBLIC_REGION_DATA_REPO)
 *   --work <dir>          Scratch directory (default a temp dir, removed after)
 *   --dry-run             Print the plan and download nothing
 *   --help                Show this text
 *
 * Requires `gh` (authenticated) and the same rclone/IA environment
 * `publish-region-mirrors.sh` reads. Nothing is uploaded twice: rclone skips
 * files whose size and checksum already match.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

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

const REPO = flag('--repo', process.env.EXPO_PUBLIC_REGION_DATA_REPO ?? 'ghobs91/polaris-maps');
const DATA_BASE = `https://github.com/${REPO}/releases/download/map-data-latest`;
const CATALOG_SPEC =
  flag('--catalog', process.env.EXPO_PUBLIC_REGION_CATALOG_URL ?? '') ||
  `${DATA_BASE}/catalog.json`;
const DRY_RUN = args.includes('--dry-run');
const SCRIPT = resolve(new URL('.', import.meta.url).pathname, 'publish-region-mirrors.sh');

/** Region ids from `--regions` and/or `--regions-file`, deduped. */
function requestedRegions() {
  const ids = new Set();
  const inline = flag('--regions', '');
  for (const id of inline.split(',')) {
    const trimmed = id.trim();
    if (trimmed) ids.add(trimmed);
  }
  const file = flag('--regions-file', '');
  if (file) {
    const parsed = JSON.parse(readFileSync(resolve(file), 'utf8'));
    // Accept either a bare array or a verifier summary's failed[] entries.
    const list = Array.isArray(parsed) ? parsed : (parsed.failed ?? []);
    for (const entry of list) {
      const id = typeof entry === 'string' ? entry : entry?.regionId;
      if (id) ids.add(String(id));
    }
  }
  return [...ids];
}

async function loadCatalog(spec) {
  if (/^https?:\/\//i.test(spec)) {
    const res = await fetch(spec, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`catalog → HTTP ${res.status}`);
    return res.json();
  }
  return JSON.parse(readFileSync(resolve(spec), 'utf8'));
}

/** Release tag a region's assets live under, read from its stamped URLs. */
function tagOf(region) {
  for (const asset of region.assets ?? []) {
    const match = /\/releases\/download\/([^/]+)\//.exec(asset.url ?? '');
    if (match) return match[1];
  }
  return null;
}

function run(command, argv, options = {}) {
  return execFileSync(command, argv, { stdio: 'inherit', ...options });
}

const ids = requestedRegions();
if (ids.length === 0) {
  console.error('Nothing to do: pass --regions or --regions-file.');
  process.exit(2);
}

const catalog = await loadCatalog(CATALOG_SPEC);
const byId = new Map(
  (catalog.regions ?? catalog.include ?? []).map((region) => [region.id, region]),
);

const plan = [];
for (const id of ids) {
  const region = byId.get(id);
  if (!region) {
    console.error(`skip ${id}: not in the catalog`);
    continue;
  }
  const tag = tagOf(region);
  if (!tag) {
    console.error(`skip ${id}: catalog entry has no release tag`);
    continue;
  }
  plan.push({ id, tag, assets: (region.assets ?? []).map((asset) => asset.name) });
}

if (plan.length === 0) {
  console.error('No region in the list could be resolved against the catalog.');
  process.exit(1);
}

console.log(`Re-mirroring ${plan.length} region(s) from ${REPO}`);
for (const entry of plan) {
  console.log(
    `  ${entry.id.padEnd(34)} ${entry.tag}  ${entry.assets.join(', ') || '(no manifest)'}`,
  );
}

if (DRY_RUN) {
  console.log('\n--dry-run: nothing downloaded or uploaded.');
  process.exit(0);
}

const workRoot = flag('--work', '') || mkdtempSync(join(tmpdir(), 'polaris-remirror-'));
const removeWork = !flag('--work', '');
let failures = 0;

for (const entry of plan) {
  const dir = join(workRoot, entry.id);
  console.log(`\n── ${entry.id} (${entry.tag})`);
  try {
    // Pull exactly this region's published assets. `gh release download` writes
    // the same `<region>-<asset>` names the mirror uploader matches on.
    run('gh', [
      'release',
      'download',
      entry.tag,
      '--repo',
      REPO,
      '--dir',
      dir,
      '--pattern',
      `${entry.id}-*`,
      '--clobber',
    ]);
    if (!existsSync(dir)) throw new Error('nothing downloaded — check the tag and asset names');
    run('bash', [SCRIPT, entry.tag, dir]);
  } catch (error) {
    failures += 1;
    console.error(`  failed: ${error instanceof Error ? error.message : String(error)}`);
    // Keep going: one bad region must not stop the rest of the batch.
  }
}

if (removeWork) {
  try {
    rmSync(workRoot, { recursive: true, force: true });
  } catch {
    // Scratch dir left behind; harmless.
  }
}

console.log(failures === 0 ? '\nAll regions re-mirrored.' : `\n${failures} region(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
