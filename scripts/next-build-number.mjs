#!/usr/bin/env node
/**
 * next-build-number.mjs
 *
 * Resolve the next iOS build number from App Store Connect.
 *
 * The build number has two owners that used to disagree: `agvtool`/the project
 * file, and `-exportArchive`, which by default rewrites CFBundleVersion to the
 * next free number on App Store Connect. A local bump was therefore cosmetic —
 * the archive said 328 while the shipped IPA said 336.
 *
 * This script makes App Store Connect the single source of truth and is meant to
 * be paired with `manageAppVersionAndBuildNumber = false` in ExportOptions.plist,
 * so the archive, the IPA, and ASC all carry the same number.
 *
 * Usage:
 *   node scripts/next-build-number.mjs            # print the next number
 *   node scripts/next-build-number.mjs --verbose  # print the reasoning too
 *   node scripts/next-build-number.mjs --set      # also apply it via agvtool
 *
 * Reads: APP_STORE_CONNECT_KEY_ID, APP_STORE_CONNECT_ISSUER_ID,
 *        APP_STORE_CONNECT_KEY_PATH
 */

import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PBXPROJ = resolve(REPO_ROOT, 'ios/PolarisMaps.xcodeproj/project.pbxproj');
const IOS_DIR = resolve(REPO_ROOT, 'ios');

// ── Pure helpers (unit-tested in next-build-number.test.mjs) ────────────────

/**
 * Highest numeric build number in a list. ASC reports versions as strings and
 * may include non-numeric values, which are ignored rather than coerced.
 */
export function maxBuildNumber(versions) {
  let max = 0;
  for (const version of versions) {
    const value = Number.parseInt(String(version), 10);
    if (Number.isFinite(value) && value > max) max = value;
  }
  return max;
}

/**
 * Next build number, never lower than what the project already carries.
 *
 * ASC is authoritative because it rejects duplicates, but it is eventually
 * consistent: a build uploaded moments ago may not be listed yet. Taking the
 * local value as a floor keeps numbering monotonic in that window instead of
 * handing back a number that was just used.
 */
export function pickNextBuild({ ascMax, localCurrent }) {
  return Math.max(ascMax || 0, localCurrent || 0) + 1;
}

/** CURRENT_PROJECT_VERSION from a pbxproj, or 0 when absent. */
export function buildNumberFromPbxproj(text) {
  return maxBuildNumber(
    [...text.matchAll(/CURRENT_PROJECT_VERSION\s*=\s*(\d+)\s*;/g)].map((match) => match[1]),
  );
}

/** Bundle id from app.json, so the script and the app cannot disagree. */
export function bundleIdFromAppConfig(config) {
  return config?.expo?.ios?.bundleIdentifier ?? null;
}

// ── App Store Connect ───────────────────────────────────────────────────────

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

/** ES256 JWT for the App Store Connect API. The key is never logged. */
export function createAscToken({ keyId, issuerId, keyPath, now = Date.now() }) {
  const issuedAt = Math.floor(now / 1000);
  const header = { alg: 'ES256', kid: keyId, typ: 'JWT' };
  const payload = { iss: issuerId, iat: issuedAt, exp: issuedAt + 600, aud: 'appstoreconnect-v1' };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = sign('sha256', Buffer.from(signingInput), {
    key: createPrivateKey(readFileSync(keyPath)),
    dsaEncoding: 'ieee-p1363',
  });
  return `${signingInput}.${base64url(signature)}`;
}

async function ascGet(path, token) {
  const response = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`ASC ${response.status} on ${path}: ${body.slice(0, 300)}`);
  }
  return response.json();
}

/** Every build version for one app, following pagination. */
export async function fetchAscBuildVersions({ token, bundleId, maxPages = 10 }) {
  const apps = await ascGet(
    `/v1/apps?filter[bundleId]=${encodeURIComponent(bundleId)}&limit=1`,
    token,
  );
  const appId = apps?.data?.[0]?.id;
  if (!appId) throw new Error(`No App Store Connect app found for bundle id ${bundleId}`);

  const versions = [];
  // The nested `/apps/{id}/builds` relationship rejects `sort`, so page through
  // instead; the cap is far above this app's build count.
  let next = `/v1/apps/${appId}/builds?limit=200&fields[builds]=version`;
  for (let page = 0; next && page < maxPages; page += 1) {
    const body = await ascGet(next, token);
    for (const build of body?.data ?? []) {
      const version = build?.attributes?.version;
      if (version != null) versions.push(version);
    }
    // `links.next` is an absolute URL; strip the host for our request helper.
    next = body?.links?.next ? body.links.next.replace('https://api.appstoreconnect.apple.com', '') : null;
  }
  return versions;
}

// ── CLI ─────────────────────────────────────────────────────────────────────

async function main(argv) {
  const verbose = argv.includes('--verbose');
  const apply = argv.includes('--set');

  const keyId = process.env.APP_STORE_CONNECT_KEY_ID;
  const issuerId = process.env.APP_STORE_CONNECT_ISSUER_ID;
  const keyPath = process.env.APP_STORE_CONNECT_KEY_PATH;
  const missing = [
    ['APP_STORE_CONNECT_KEY_ID', keyId],
    ['APP_STORE_CONNECT_ISSUER_ID', issuerId],
    ['APP_STORE_CONNECT_KEY_PATH', keyPath],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) {
    console.error(`Missing App Store Connect credentials: ${missing.join(', ')}`);
    console.error('The build number is resolved from ASC, so these are required.');
    return 1;
  }

  const config = JSON.parse(readFileSync(resolve(REPO_ROOT, 'app.json'), 'utf8'));
  const bundleId = bundleIdFromAppConfig(config);
  if (!bundleId) {
    console.error('No expo.ios.bundleIdentifier in app.json');
    return 1;
  }

  const localCurrent = buildNumberFromPbxproj(readFileSync(PBXPROJ, 'utf8'));

  let ascMax;
  try {
    const token = createAscToken({ keyId, issuerId, keyPath });
    ascMax = maxBuildNumber(await fetchAscBuildVersions({ token, bundleId }));
  } catch (error) {
    console.error(`Could not read build numbers from App Store Connect: ${error.message}`);
    console.error(
      'Refusing to guess — a collision only fails at upload, after a full build.',
    );
    return 1;
  }

  const next = pickNextBuild({ ascMax, localCurrent });

  if (verbose) {
    console.error(`bundle id:      ${bundleId}`);
    console.error(`ASC latest:     ${ascMax}`);
    console.error(`project latest: ${localCurrent}`);
    console.error(`next:           ${next}`);
  }

  if (apply) {
    execFileSync('xcrun', ['agvtool', 'new-version', '-all', String(next)], {
      cwd: IOS_DIR,
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    if (verbose) console.error(`applied to the Xcode project`);
  }

  console.log(next);
  return 0;
}

// Run only as a CLI, so the helpers stay importable from tests.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = await main(process.argv.slice(2));
}
