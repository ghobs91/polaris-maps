#!/usr/bin/env node
/**
 * Generate an Apple MapKit JS JWT for EXPO_PUBLIC_APPLE_MAPKIT_TOKEN.
 *
 * Required env vars:
 *   APPLE_TEAM_ID
 *   APPLE_KEY_ID
 *   APPLE_MAPKIT_PRIVATE_KEY_PATH or APPLE_MAPKIT_PRIVATE_KEY
 *
 * Optional env vars:
 *   APPLE_MAPKIT_TTL_DAYS (default: 30, max: 180)
 *
 * Example:
 *   APPLE_TEAM_ID=ABC123XYZ \
 *   APPLE_KEY_ID=DEF456GHI \
 *   APPLE_MAPKIT_PRIVATE_KEY_PATH=~/AuthKey_DEF456GHI.p8 \
 *   pnpm mapkit:token
 */

import { createPrivateKey, createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

export function buildMapkitJwt({
  teamId,
  keyId,
  privateKeyPem,
  now = Math.floor(Date.now() / 1000),
  ttlDays = 30,
}) {
  if (!teamId) throw new Error('APPLE_TEAM_ID is required');
  if (!keyId) throw new Error('APPLE_KEY_ID is required');
  if (!privateKeyPem) throw new Error('Apple private key is required');

  const clampedTtlDays = Math.min(Math.max(Number(ttlDays) || 30, 1), 180);
  const header = { alg: 'ES256', kid: keyId, typ: 'JWT' };
  const payload = {
    iss: teamId,
    iat: now,
    exp: now + clampedTtlDays * 24 * 60 * 60,
  };

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const signer = createSign('SHA256');
  signer.update(signingInput);
  signer.end();

  const privateKey = createPrivateKey(privateKeyPem);
  const signature = signer.sign({ key: privateKey, dsaEncoding: 'ieee-p1363' });

  return `${signingInput}.${base64url(signature)}`;
}

function readPrivateKey() {
  if (process.env.APPLE_MAPKIT_PRIVATE_KEY) {
    return process.env.APPLE_MAPKIT_PRIVATE_KEY;
  }
  if (process.env.APPLE_MAPKIT_PRIVATE_KEY_PATH) {
    return readFileSync(process.env.APPLE_MAPKIT_PRIVATE_KEY_PATH, 'utf8');
  }
  throw new Error('Set APPLE_MAPKIT_PRIVATE_KEY_PATH or APPLE_MAPKIT_PRIVATE_KEY');
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1])) {
  const token = buildMapkitJwt({
    teamId: process.env.APPLE_TEAM_ID,
    keyId: process.env.APPLE_KEY_ID,
    privateKeyPem: readPrivateKey(),
    ttlDays: process.env.APPLE_MAPKIT_TTL_DAYS,
  });
  process.stdout.write(`${token}\n`);
}
