#!/usr/bin/env node
/**
 * verify-gtfs-feeds.mjs — prove every mapped GTFS feed still downloads and is
 * a usable GTFS archive.
 *
 * `scripts/gtfs-feeds.json` is a claim about the outside world, and the outside
 * world moves: agencies rotate file hashes (Paris), rename feeds (Geofabrik did
 * exactly this to two region URLs), add WAF rules (SPTrans now 403s a bare
 * curl), and move whole portals. A stale URL is not a crash — CI degrades to a
 * pack without a timetable and says so in one warning line — which means it can
 * rot silently for months.
 *
 * This script is the thing that notices.
 *
 *   node scripts/verify-gtfs-feeds.mjs             # every feed
 *   node scripts/verify-gtfs-feeds.mjs --only us-az-phoenix
 *   node scripts/verify-gtfs-feeds.mjs --json      # machine-readable
 *   node scripts/verify-gtfs-feeds.mjs --quick     # status + zip magic only
 *
 * Exit code 1 if any feed fails, so it can gate a build.
 *
 * No dependencies: the zip is read from its central directory directly, which
 * avoids unpacking multi-hundred-megabyte feeds just to list four filenames.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const FEEDS_PATH = path.join(ROOT, 'scripts', 'gtfs-feeds.json');
const REQUIRED = ['stops.txt', 'routes.txt', 'trips.txt', 'stop_times.txt'];
const MAX_BYTES = 512 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

/** Files a GTFS must carry for `build-transit-timetable.py` to produce anything useful. */
export function missingMembers(members) {
  const names = members.map((m) => m.toLowerCase());
  return REQUIRED.filter((req) => !names.some((n) => n === req || n.endsWith(`/${req}`)));
}

/**
 * Read the zip central directory of an already-downloaded file.
 *
 * Returns the member filenames, or throws with a message worth reading when the
 * payload is not a zip at all (agencies return HTML error pages from a URL that
 * still answers 200, which is the failure mode that would otherwise reach
 * Python with a .zip extension).
 */
export async function listZipMembers(filePath) {
  const handle = await open(filePath, 'r');
  try {
    const { size } = await handle.stat();
    if (size < 22) throw new Error(`not a zip (${size} bytes)`);

    // EOCD is in the last 22 bytes plus up to 65535 of comment.
    const tailLen = Math.min(size, 22 + 0xffff);
    const tail = Buffer.alloc(tailLen);
    await handle.read(tail, 0, tailLen, size - tailLen);

    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i -= 1) {
      if (tail.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd === -1) throw new Error('not a zip (no end-of-central-directory record)');

    const entries = tail.readUInt16LE(eocd + 10);
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOffset = tail.readUInt32LE(eocd + 16);
    // Zip64 puts 0xffffffff here; none of these feeds are that large.
    if (cdOffset === 0xffffffff || cdSize === 0xffffffff)
      throw new Error('zip64 archives are not supported');

    const cd = Buffer.alloc(cdSize);
    await handle.read(cd, 0, cdSize, cdOffset);

    const names = [];
    let p = 0;
    for (let i = 0; i < entries && p + 46 <= cd.length; i += 1) {
      if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error('corrupt zip central directory');
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      names.push(cd.toString('utf8', p + 46, p + 46 + nameLen));
      p += 46 + nameLen + extraLen + commentLen;
    }
    return names;
  } finally {
    await handle.close();
  }
}

function headerList(headers = {}) {
  const args = [];
  for (const [k, v] of Object.entries(headers)) args.push('-H', `${k}: ${v}`);
  return args;
}

/** curl, not fetch: these hosts redirect to presigned URLs and need byte-range + retry semantics. */
function download(url, filePath, headers = {}) {
  execFileSync(
    'curl',
    [
      '-fSL',
      '--retry',
      '2',
      '--retry-delay',
      '3',
      '--max-time',
      String(Math.floor(DEFAULT_TIMEOUT_MS / 1000)),
      '--max-filesize',
      String(MAX_BYTES),
      ...headerList(headers),
      '-o',
      filePath,
      url,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
}

/**
 * Extract one member from an archive, using Python because the build already
 * requires it (`build-transit-timetable.py`) and it handles zip64 and encoding
 * without another dependency.
 */
export function extractMember(archivePath, member, outPath) {
  execFileSync(
    'python3',
    [
      '-c',
      [
        'import sys, zipfile',
        'src, member, out = sys.argv[1:4]',
        'with zipfile.ZipFile(src) as z:',
        '    with z.open(member) as r, open(out, "wb") as w:',
        '        w.write(r.read())',
      ].join('\n'),
      archivePath,
      member,
      outPath,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
}

/**
 * Download a mapped feed and return a path to a GTFS zip.
 *
 * Some authorities publish a *bundle* rather than a feed: PTV Victoria ships
 * one archive holding eleven `google_transit.zip` members, one per mode. An
 * entry can name the member it wants with `extract`; without that the builder
 * would receive a zip-of-zips and fail, which is exactly what happened to
 * Melbourne.
 */
export function fetchArchive(entry, workDir) {
  const bundle = path.join(workDir, 'download.zip');
  download(entry.url, bundle, entry.headers);
  if (!entry.extract) return bundle;

  const out = path.join(workDir, 'extracted.zip');
  extractMember(bundle, entry.extract, out);
  return out;
}

export async function verifyFeed(id, entry, { quick = false } = {}) {
  const started = Date.now();
  const dir = mkdtempSync(path.join(tmpdir(), 'gtfs-verify-'));
  try {
    if (quick) {
      const file = path.join(dir, 'probe.bin');
      const out = execFileSync(
        'curl',
        [
          '-fSL',
          '--retry',
          '2',
          '--max-time',
          '120',
          '-r',
          '0-3',
          ...headerList(entry.headers),
          '-o',
          file,
          entry.url,
        ],
        { encoding: 'buffer', stdio: ['ignore', 'pipe', 'pipe'] },
      );
      const isZip = out.length >= 2 && out[0] === 0x50 && out[1] === 0x4b;
      return {
        id,
        ok: isZip,
        label: entry.label,
        bytes: null,
        ms: Date.now() - started,
        detail: isZip ? 'zip magic ok' : 'response did not start with a zip signature',
      };
    }

    const archive = fetchArchive(entry, dir);
    const bundleBytes = statSync(path.join(dir, 'download.zip')).size;
    const members = await listZipMembers(archive);
    if (members.length === 0) throw new Error('zip is empty');
    const missing = missingMembers(members);
    if (missing.length > 0) throw new Error(`zip is not GTFS — missing ${missing.join(', ')}`);

    return {
      id,
      ok: true,
      label: entry.label,
      bytes: statSync(archive).size,
      bundleBytes: entry.extract ? bundleBytes : null,
      members: members.length,
      ms: Date.now() - started,
      detail: `${members.length} members${entry.extract ? ` (from bundle, ${entry.extract})` : ''}`,
    };
  } catch (error) {
    const stderr = error.stderr ? String(error.stderr).trim().split('\n').slice(-1)[0] : '';
    return {
      id,
      ok: false,
      label: entry.label,
      bytes: null,
      ms: Date.now() - started,
      detail: stderr || error.message,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function mb(bytes) {
  return bytes === null ? '     —' : `${(bytes / 1048576).toFixed(1).padStart(6)} MB`;
}

/**
 * Validate a zip that is already on disk. Exposed because the interesting bugs
 * here are in the reader (EOCD offsets, nested directories, a 200 that is
 * HTML), and those are worth testing without a network round trip.
 */
async function checkFile(filePath) {
  try {
    const members = await listZipMembers(filePath);
    const missing = missingMembers(members);
    return { ok: missing.length === 0, bytes: statSync(filePath).size, members, missing };
  } catch (error) {
    return { ok: false, bytes: null, members: [], missing: REQUIRED, error: error.message };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const quick = args.includes('--quick');
  const asJson = args.includes('--json');

  const checkIndex = args.indexOf('--check');
  if (checkIndex !== -1) {
    const target = args[checkIndex + 1];
    if (!target) {
      console.error('usage: --check <path-to-zip>');
      process.exit(2);
    }
    const result = await checkFile(target);
    if (asJson) console.log(JSON.stringify(result, null, 2));
    else
      console.log(
        result.ok
          ? `ok    ${result.members.length} members, ${mb(result.bytes)}`
          : `FAIL  ${result.error ?? `missing ${result.missing.join(', ')}`}`,
      );
    process.exit(result.ok ? 0 : 1);
  }

  const onlyIndex = args.indexOf('--only');
  const only = onlyIndex === -1 ? null : args[onlyIndex + 1];

  const { feeds = {}, candidates = {} } = JSON.parse(readFileSync(FEEDS_PATH, 'utf8'));
  const ids = only ? [only] : Object.keys(feeds);

  if (only && !feeds[only]) {
    const why = candidates[only]?.blocked_by;
    console.error(
      why
        ? `${only} is a candidate, not a mapped feed — ${why}`
        : `${only} is not in scripts/gtfs-feeds.json`,
    );
    process.exit(1);
  }

  // Sequential on purpose: these are multi-megabyte downloads and being a
  // nuisance to public infrastructure is how feeds get IP-banned.
  const results = [];
  for (const id of ids) {
    const result = await verifyFeed(id, feeds[id], { quick });
    results.push(result);
    if (!asJson) {
      const mark = result.ok ? 'ok  ' : 'FAIL';
      console.log(`${mark}  ${id.padEnd(22)} ${mb(result.bytes)}  ${result.detail}`);
    }
  }

  if (asJson) {
    console.log(
      JSON.stringify(
        { results, mapped: ids.length, candidates: Object.keys(candidates).length },
        null,
        2,
      ),
    );
  } else {
    const failed = results.filter((r) => !r.ok);
    console.log(
      `\n${results.length - failed.length}/${results.length} feeds verified` +
        (failed.length ? ` — ${failed.length} failed` : ''),
    );
  }

  process.exit(results.some((r) => !r.ok) ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
