#!/usr/bin/env node
/**
 * One TestFlight deploy at a time.
 *
 * Two deployers running at once on this Mac is not hypothetical: builds 388,
 * 390, 392 and 397 appeared within minutes of manual uploads, from a second
 * session, with `buildAudienceType` INTERNAL_ONLY — they never reach
 * `IN_BETA_TESTING`, so they never appear in the TestFlight app, and they burn
 * build numbers. One of them cost a full archive-and-export before App Store
 * Connect rejected the upload as a duplicate.
 *
 * A deploy is minutes of archiving against a shared project file and a shared
 * build-number counter, so the two must be serialized. `mkdir` is atomic on
 * every filesystem we care about, which makes it the lock primitive here —
 * macOS has no `flock(1)`.
 *
 * Usage:
 *   node scripts/deploy-lock.mjs acquire [--label "what"] [--ttl 120]
 *   node scripts/deploy-lock.mjs release
 *   node scripts/deploy-lock.mjs status
 *
 * Exit codes: 0 acquired/held by us, 1 failed, 3 already held by someone else.
 */

import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOCK_DIR = resolve(ROOT, 'build/.deploy.lock');
const HOLDER = resolve(LOCK_DIR, 'holder.json');
const DEFAULT_TTL_MINUTES = 120;

function readHolder() {
  try {
    return JSON.parse(readFileSync(HOLDER, 'utf8'));
  } catch {
    return null;
  }
}

function ageMinutes() {
  try {
    return (Date.now() - statSync(LOCK_DIR).mtimeMs) / 60_000;
  } catch {
    return 0;
  }
}

function describe(holder) {
  if (!holder) return 'unknown holder';
  return `${holder.label ?? 'deploy'} (pid ${holder.pid}, ${holder.host ?? 'this host'}, since ${holder.startedAt})`;
}

function acquire(label, ttlMinutes) {
  const existing = readHolder();
  if (existing) {
    if (ageMinutes() > ttlMinutes) {
      // A deploy that died mid-archive (killed terminal, crashed xcodebuild)
      // must not block every later deploy.
      console.error(
        `stale lock (${Math.round(ageMinutes())}m old) — taking over from ${describe(existing)}`,
      );
      rmSync(LOCK_DIR, { recursive: true, force: true });
    } else {
      console.error(`deploy already in progress: ${describe(existing)}`);
      console.error(`if that is wrong, remove ${LOCK_DIR}`);
      return 3;
    }
  }

  try {
    mkdirSync(LOCK_DIR);
  } catch (error) {
    if (error.code === 'EEXIST') {
      console.error(`deploy already in progress: ${describe(readHolder())}`);
      return 3;
    }
    throw error;
  }

  writeFileSync(
    HOLDER,
    JSON.stringify(
      {
        pid: process.pid,
        host: process.env.HOSTNAME ?? 'this-host',
        label,
        startedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log(`deploy lock acquired: ${label}`);
  return 0;
}

function release() {
  const holder = readHolder();
  if (!holder) {
    console.log('no deploy lock held');
    return 0;
  }
  rmSync(LOCK_DIR, { recursive: true, force: true });
  console.log(`deploy lock released (${describe(holder)})`);
  return 0;
}

function status() {
  const holder = readHolder();
  if (!holder) {
    console.log('no deploy lock held');
    return 0;
  }
  console.log(`deploy lock held by ${describe(holder)} (${Math.round(ageMinutes())}m)`);
  return 0;
}

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

function main() {
  const action = process.argv[2];
  switch (action) {
    case 'acquire':
      return acquire(
        argValue('--label') ?? 'testflight deploy',
        Number(argValue('--ttl') ?? DEFAULT_TTL_MINUTES),
      );
    case 'release':
      return release();
    case 'status':
      return status();
    default:
      console.error('usage: deploy-lock.mjs acquire|release|status');
      return 1;
  }
}

if (process.argv[1] && process.argv[1].endsWith('deploy-lock.mjs')) {
  process.exit(main());
}
