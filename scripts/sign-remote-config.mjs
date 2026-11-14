#!/usr/bin/env node
/**
 * Sign a remote feature-flag document with the Polaris publisher key.
 *
 * Usage:
 *   POLARIS_CONFIG_PRIVATE_KEY=<64-hex> \
 *     node scripts/sign-remote-config.mjs config.json > signed-config.json
 *
 * The input is `{ "version": 1, "issuedAt": "...", "flags": { ... } }`.
 * Output adds `publisherPubkey` and `signature`. Publish the output at
 * EXPO_PUBLIC_REMOTE_CONFIG_URL (default https://app.polarismaps.app/config.json).
 *
 * IMPORTANT: the payload field order here must match
 * `src/services/config/remoteConfig.ts` (`FLAG_ORDER`). The unit test
 * `remoteConfigSignature.test.ts` runs this script and verifies its output, so
 * drift fails CI.
 */

import { readFileSync } from 'node:fs';
import { schnorr } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha256';

const FLAG_ORDER = [
  'trafficP2P',
  'regionDownloads',
  'streetView',
  'overturePlaces',
  'tomtomBridge',
];

const [, , inputPath] = process.argv;
const privateKeyHex = process.env.POLARIS_CONFIG_PRIVATE_KEY;

if (!inputPath || !privateKeyHex) {
  console.error(
    'usage: POLARIS_CONFIG_PRIVATE_KEY=<64-hex> node scripts/sign-remote-config.mjs <config.json>',
  );
  process.exit(1);
}

const raw = JSON.parse(readFileSync(inputPath, 'utf8'));
const flags = {};
for (const flag of FLAG_ORDER) {
  flags[flag] = raw.flags?.[flag] !== false;
}

/**
 * Unsigned kill switches travel in the document but not in the signature.
 * Signing them would invalidate every config already installed in the field;
 * their only effect is enabling/disabling an optional third-party fallback.
 * Mirrors `RemoteConfigFlags.overpassQuery` / `nominatimFallback`.
 */
const UNSIGNED_FLAGS = ['overpassQuery', 'nominatimFallback'];
for (const flag of UNSIGNED_FLAGS) {
  if (typeof raw.flags?.[flag] === 'boolean') flags[flag] = raw.flags[flag];
}

const version = Number.isInteger(raw.version) && raw.version > 0 ? raw.version : 1;
const issuedAt = typeof raw.issuedAt === 'string' ? raw.issuedAt : new Date().toISOString();
const privateKey = Uint8Array.from(Buffer.from(privateKeyHex, 'hex'));
const publisherPubkey = Buffer.from(schnorr.getPublicKey(privateKey)).toString('hex');

const payload = [
  version,
  issuedAt,
  ...FLAG_ORDER.map((flag) => (flags[flag] ? 1 : 0)),
  publisherPubkey,
]
  .map(String)
  .join('\0');
const signature = Buffer.from(
  schnorr.sign(sha256(new TextEncoder().encode(payload)), privateKey),
).toString('hex');

process.stdout.write(
  `${JSON.stringify({ version, issuedAt, flags, publisherPubkey, signature }, null, 2)}\n`,
);
