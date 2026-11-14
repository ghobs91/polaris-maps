#!/usr/bin/env node
/**
 * fetch-gtfs-feed.mjs — download one region's GTFS feed for the pack build.
 *
 * Exists so the workflow never has to assemble curl flags from JSON in shell:
 * per-feed `headers` (SPTrans 403s a bare curl), redirects to presigned URLs
 * (Phoenix, ODPT), bundle archives that hold one feed per mode (PTV Victoria),
 * and "the server answered 200 with an HTML error page" all need handling, and
 * shell quoting is where that handling goes wrong.
 *
 *   node scripts/fetch-gtfs-feed.mjs <region-id> <out-file>
 *
 * Exit codes, because the caller distinguishes them:
 *   0  downloaded and looks like GTFS
 *   1  mapped but failed (network, 4xx/5xx, or the payload is not GTFS)
 *   3  no feed mapped for this region — not an error, ships without a timetable
 */

import { mkdtempSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { fetchArchive, listZipMembers, missingMembers } from './verify-gtfs-feeds.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');

const [regionId, outFile] = process.argv.slice(2);
if (!regionId || !outFile) {
  console.error('usage: fetch-gtfs-feed.mjs <region-id> <out-file>');
  process.exit(2);
}

const { feeds = {}, candidates = {} } = JSON.parse(
  readFileSync(path.join(ROOT, 'scripts', 'gtfs-feeds.json'), 'utf8'),
);

const entry = feeds[regionId];
if (!entry || !entry.url) {
  const why = candidates[regionId]?.blocked_by;
  console.log(
    why
      ? `${regionId}: no feed mapped (${why})`
      : `${regionId}: no GTFS feed mapped — shipping without a timetable`,
  );
  process.exit(3);
}

const dir = mkdtempSync(path.join(tmpdir(), 'gtfs-fetch-'));

try {
  const archive = fetchArchive(entry, dir);
  const bytes = statSync(archive).size;
  if (bytes === 0) throw new Error('downloaded 0 bytes');

  // A 200 that is really a login page or a Cloudflare challenge reaches here as
  // a .zip with HTML inside; catch it before Python sees it.
  const members = await listZipMembers(archive);
  const missing = missingMembers(members);
  if (missing.length > 0) throw new Error(`not GTFS — missing ${missing.join(', ')}`);

  renameSync(archive, outFile);
  console.log(
    `${regionId}: ${entry.label} — ${(bytes / 1048576).toFixed(1)} MB, ${members.length} members` +
      (entry.extract ? ` (extracted from ${entry.extract})` : ''),
  );
} catch (error) {
  console.error(`${regionId}: GTFS download failed — ${error.message}`);
  process.exit(1);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
