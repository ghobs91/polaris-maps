/**
 * Signed relay availability announcements.
 *
 * A phone needs to know that *something always-on* covers a region before it can
 * decline to seed that region itself. Swarm connections cannot answer that — a
 * connection looks identical whether the peer is a Mac or another phone — so the
 * relay publishes a signed announcement on the existing Gun.js gossip channel:
 *
 *   polaris / relays / <relayPubkey>
 *
 * The announcement carries availability metadata only. It never carries pack
 * content and never carries a key the client would trust *for content*: pack
 * integrity stays with the canonical drive key (ed25519 writer-signed blocks),
 * the signed region manifest, and per-asset md5. So a forged announcement can
 * only make one phone schedule badly — it cannot make it install the wrong
 * bytes. That is exactly why it is acceptable for this to be self-signed rather
 * than tied to the manifest publisher trust root.
 *
 * The signing scheme is the app's: secp256k1 Schnorr over SHA-256 of a
 * `\0`-joined canonical field string (`src/services/identity/signing.ts`). The
 * payload string must be byte-identical on both sides; `announcementPayload` here
 * is pinned against the TypeScript implementation by a test fixture, because a
 * one-character divergence would make every announcement silently unverifiable.
 */

import { schnorr } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import b4a from 'b4a';

export const ANNOUNCEMENT_VERSION = 1;
export const ANNOUNCEMENT_TTL_MS = 30 * 60 * 1000;

/** @typedef {{ regionId: string, version: string, driveKey: string, bytes: number }} AnnouncedRegion */

/**
 * Canonical payload string for signing.
 *
 * Field order is part of the wire contract — never reorder, never insert. Regions
 * are sorted by `regionId` so two relays serving the same set produce the same
 * payload regardless of pin order.
 *
 * @param {object} announcement
 * @param {string} announcement.relayPubkey
 * @param {AnnouncedRegion[]} announcement.regions
 * @param {number} announcement.capacityBytes
 * @param {number} announcement.usedBytes
 * @param {number} announcement.uplinkKbps
 * @param {boolean} announcement.paused
 * @param {string | null} announcement.pausedReason
 * @param {number} announcement.servedBytes24h
 * @param {number} announcement.updatedAt
 * @param {string} announcement.statusHash
 * @returns {string}
 */
export function announcementPayload(announcement) {
  const regions = [...announcement.regions]
    .sort((a, b) => (a.regionId < b.regionId ? -1 : a.regionId > b.regionId ? 1 : 0))
    .map((r) => `${r.regionId}@${r.version}@${r.driveKey}`)
    .join(',');

  return [
    ANNOUNCEMENT_VERSION,
    announcement.relayPubkey,
    regions,
    announcement.capacityBytes,
    announcement.usedBytes,
    announcement.uplinkKbps,
    announcement.paused ? 'true' : 'false',
    announcement.pausedReason ?? '',
    announcement.servedBytes24h,
    announcement.updatedAt,
    announcement.statusHash ?? '',
  ]
    .map(String)
    .join('\u0000');
}

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Build and sign an announcement.
 *
 * @param {object} input
 * @param {Uint8Array} input.privateKey secp256k1 private key (32 bytes)
 * @param {AnnouncedRegion[]} input.regions
 * @param {number} input.capacityBytes
 * @param {number} input.usedBytes
 * @param {number} input.uplinkKbps
 * @param {boolean} input.paused
 * @param {string | null} input.pausedReason
 * @param {number} input.servedBytes24h
 * @param {number} input.updatedAt
 * @param {object} [input.status] full dashboard status, hashed into the signature
 */
export function buildAnnouncement(input) {
  // The dashboard's status payload is carried as an opaque JSON string and bound
  // to the signature by a hash. A string (not a nested field in the signed
  // payload) so no ordering rule has to agree across runtimes: the client hashes
  // the exact bytes it received.
  const statusJson = input.status ? JSON.stringify(input.status) : '';
  const statusHash = statusJson ? b4a.toString(sha256(b4a.from(statusJson)), 'hex') : '';
  const relayPubkey = bytesToHex(schnorr.getPublicKey(input.privateKey));
  const base = {
    v: ANNOUNCEMENT_VERSION,
    relayPubkey,
    regions: [...input.regions].sort((a, b) =>
      a.regionId < b.regionId ? -1 : a.regionId > b.regionId ? 1 : 0,
    ),
    capacityBytes: input.capacityBytes,
    usedBytes: input.usedBytes,
    uplinkKbps: input.uplinkKbps,
    paused: input.paused,
    pausedReason: input.pausedReason,
    servedBytes24h: input.servedBytes24h,
    updatedAt: input.updatedAt,
    statusHash,
    statusJson,
  };

  const digest = sha256(new TextEncoder().encode(announcementPayload(base)));
  const signature = bytesToHex(schnorr.sign(digest, input.privateKey));

  return { ...base, signature };
}

/** Verify an announcement the way a client would. */
export function verifyAnnouncement(announcement) {
  if (!announcement || typeof announcement !== 'object') return false;
  if (announcement.v !== ANNOUNCEMENT_VERSION) return false;
  // x-only secp256k1 public key: 32 bytes, hex-encoded (the same form
  // `src/services/identity/signing.ts` produces and verifies).
  if (
    typeof announcement.relayPubkey !== 'string' ||
    !/^[0-9a-f]{64}$/i.test(announcement.relayPubkey)
  ) {
    return false;
  }
  if (typeof announcement.signature !== 'string') return false;
  if (!Array.isArray(announcement.regions)) return false;

  // The status payload must hash to what was signed, otherwise a reader could
  // swap the dashboard numbers under a valid signature.
  if (typeof announcement.statusHash === 'string' && announcement.statusHash) {
    const json = typeof announcement.statusJson === 'string' ? announcement.statusJson : '';
    const hash = b4a.toString(sha256(b4a.from(json)), 'hex');
    if (hash !== announcement.statusHash) return false;
  }

  try {
    const digest = sha256(new TextEncoder().encode(announcementPayload(announcement)));
    return schnorr.verify(hexToBytes(announcement.signature), digest, announcement.relayPubkey);
  } catch {
    return false;
  }
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Publish an announcement through a Gun instance.
 *
 * @param {{ get: (key: string) => any }} gun
 * @param {object} announcement
 */
export function publishAnnouncement(gun, announcement) {
  gun
    .get('polaris')
    .get('relays')
    .get(announcement.relayPubkey.trim().toLowerCase())
    .put(announcement);
}

/**
 * Decide whether an announcement still counts as "covered".
 *
 * @param {{ updatedAt?: unknown }} announcement
 * @param {number} now
 * @param {number} [ttlMs]
 */
export function isAnnouncementFresh(announcement, now, ttlMs = ANNOUNCEMENT_TTL_MS) {
  const updatedAt = Number(announcement?.updatedAt);
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return false;
  // A clock-skewed future timestamp must not make an announcement immortal.
  if (updatedAt > now + ttlMs) return false;
  return now - updatedAt <= ttlMs;
}
