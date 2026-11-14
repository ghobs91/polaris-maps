#!/usr/bin/env node
/**
 * pack-release-tag.mjs — the dated release tag that carries a region's assets.
 *
 * At full-world parity the catalog is ~363 regions × ~7 assets ≈ 2,500 files.
 * GitHub caps a release at 1,000 assets, so packs are split across a fixed
 * number of sibling tags (`map-data-2026-11-a`, `…-b`, …) by a deterministic
 * hash of the region id. Both sides of the pipeline must agree, and they do so
 * by calling this script rather than by sharing state:
 *
 *   - the build job uploads a region's assets to its tag;
 *   - the publish job enumerates the tags, merges checksums, and stamps the
 *     catalog with each region's tag;
 *   - the prune job groups suffixed tags by their year-month.
 *
 * Usage:
 *   node scripts/pack-release-tag.mjs <regionId> [--date YYYY-MM] [--count n]
 *
 * `--date` defaults to the current UTC month. `--count` is the number of
 * sibling tags (default 4; override identically everywhere or the mapping
 * splits).
 */

const DEFAULT_COUNT = 6;

/** Deterministic FNV-1a — stable across processes, no dependencies. */
function hash32(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function releaseTagForRegion(regionId, { date, count = DEFAULT_COUNT } = {}) {
  if (!regionId) throw new Error('regionId is required');
  if (!Number.isInteger(count) || count < 1 || count > 26) {
    throw new Error(`count must be an integer in 1..26 (got ${count})`);
  }
  const ym = (date ?? new Date().toISOString().slice(0, 7)).slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(ym)) throw new Error(`date must be YYYY-MM (got ${date})`);
  const suffix = String.fromCharCode(97 + (hash32(regionId) % count));
  return `map-data-${ym}-${suffix}`;
}

function main() {
  const args = process.argv.slice(2);
  const help = args.includes('--help') || args.includes('-h');
  if (help || args.length === 0) {
    console.log('usage: node scripts/pack-release-tag.mjs <regionId> [--date YYYY-MM] [--count n]');
    return help ? 0 : 1;
  }
  const dateFlag = args.indexOf('--date');
  const countFlag = args.indexOf('--count');
  try {
    const tag = releaseTagForRegion(args[0], {
      date: dateFlag !== -1 ? args[dateFlag + 1] : undefined,
      count: countFlag !== -1 ? Number(args[countFlag + 1]) : undefined,
    });
    process.stdout.write(tag);
    return 0;
  } catch (err) {
    console.error(`error: ${err.message}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}
