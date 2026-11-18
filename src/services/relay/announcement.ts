import { sha256 } from '@noble/hashes/sha256';
import { verify } from '../identity/signing';

function sha256Bytes(text: string): Uint8Array {
  return sha256(new TextEncoder().encode(text));
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Decode the status payload, or null when it is absent or unparseable. */
export function parseRelayStatus(announcement: RelayAnnouncement): RelayStatusPayload | null {
  if (!announcement.statusJson) return null;
  try {
    const parsed = JSON.parse(announcement.statusJson) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as RelayStatusPayload;
  } catch {
    return null;
  }
}

/**
 * Signed relay availability announcements.
 *
 * A phone can only decline to seed a pack if it knows something always-on covers
 * it. A swarm connection cannot answer that — a peer looks the same whether it is
 * a Mac or another phone — so desktop relays publish this record on the existing
 * Gun.js gossip channel (`polaris/relays/<relayPubkey>`), signed with the relay's
 * own identity.
 *
 * **Availability metadata only.** An announcement never carries pack content and
 * never carries a key this module would trust *for content*: integrity stays with
 * the canonical drive key (ed25519 writer-signed blocks), the signed region
 * manifest, and per-asset md5 verification. A forged announcement can therefore
 * only make one device schedule badly, which is why self-signing is acceptable
 * here where the manifest trust root is not negotiable.
 *
 * The payload string must be byte-identical to the relay's
 * (`relay/src/announce.mjs`); `__tests__/unit/relayAnnouncement.test.ts` pins both
 * against one shared fixture, because a one-character divergence would make every
 * announcement silently unverifiable and the failure would look like "no relays
 * online".
 */

export const ANNOUNCEMENT_VERSION = 1;

/** Freshness window. The relay republishes every 5 minutes. */
export const ANNOUNCEMENT_TTL_MS = 30 * 60 * 1000;

export interface AnnouncedRegion {
  regionId: string;
  version: string;
  driveKey: string;
  bytes: number;
}

/**
 * The relay's full dashboard state, carried inside the announcement.
 *
 * Transported as an opaque JSON string (`statusJson`) and bound to the signature
 * by `statusHash`, so no key-ordering rule has to agree across runtimes: the
 * client hashes the exact bytes it received.
 */
export interface RelayStatusPayload {
  version: number;
  serving: boolean;
  pauseReason: string | null;
  power: 'ac' | 'battery' | 'unknown';
  lowPowerMode: boolean;
  metered: boolean;
  relayPubkey: string;
  uptimeSec: number;
  drives: Array<{
    regionId: string;
    key: string;
    discoveryKey: string;
    peers: number;
    readOnly: boolean;
    bytes: number;
    pinned: boolean;
    lastRequestedAt: number;
  }>;
  pins: Array<{ regionId: string; version: string; pinnedAt: number }>;
  devices: Array<{ pubkey: string; label: string; authorizedAt: number }>;
  usage: { month: string; usedBytes: number; capBytes: number; servedBytes24h: number };
  budgets: {
    packStoreBytes: number;
    usedBytes: number;
    maxPeers: number;
    maxBitsPerSecond: number;
    maxBitsPerSecondPerPeer: number;
  };
  preferences: { seedOnBattery: boolean; seedOnMetered: boolean; pausedByUser: boolean };
  configWarnings: string[];
  errors: string[];
}

export interface RelayAnnouncement {
  v: number;
  relayPubkey: string;
  regions: AnnouncedRegion[];
  capacityBytes: number;
  usedBytes: number;
  uplinkKbps: number;
  paused: boolean;
  pausedReason: string | null;
  servedBytes24h: number;
  updatedAt: number;
  /** Hash of `statusJson`; empty when the relay carries no status payload. */
  statusHash: string;
  /** Opaque JSON of `RelayStatusPayload`, integrity-bound by `statusHash`. */
  statusJson: string;
  signature: string;
}

/**
 * Canonical signed payload. Field order is the wire contract — append only after
 * a version bump, never reorder.
 */
export function announcementPayload(announcement: {
  relayPubkey: string;
  regions: AnnouncedRegion[];
  capacityBytes: number;
  usedBytes: number;
  uplinkKbps: number;
  paused: boolean;
  pausedReason: string | null;
  servedBytes24h: number;
  updatedAt: number;
  statusHash?: string;
}): string {
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

const HEX_32_BYTES = /^[0-9a-f]{64}$/i;

function asNumber(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/**
 * Shape-check an untrusted record before it is used at all.
 *
 * A gossip channel is an open write surface: anything can appear at the path.
 * Numbers are coerced (Gun round-trips them as strings) but nothing else is
 * repaired — a record that does not fit the schema is dropped, not patched.
 */
export function parseAnnouncement(value: unknown): RelayAnnouncement | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;

  if (asNumber(record.v) !== ANNOUNCEMENT_VERSION) return null;
  if (typeof record.relayPubkey !== 'string' || !HEX_32_BYTES.test(record.relayPubkey)) return null;
  if (!Array.isArray(record.regions)) return null;
  if (typeof record.signature !== 'string') return null;

  const regions: AnnouncedRegion[] = [];
  for (const entry of record.regions) {
    if (!entry || typeof entry !== 'object') return null;
    const region = entry as Record<string, unknown>;
    if (typeof region.regionId !== 'string' || region.regionId.length === 0) return null;
    if (typeof region.driveKey !== 'string' || !HEX_32_BYTES.test(region.driveKey)) return null;
    regions.push({
      regionId: region.regionId,
      version: typeof region.version === 'string' ? region.version : 'unknown',
      driveKey: region.driveKey.toLowerCase(),
      bytes: asNumber(region.bytes) ?? 0,
    });
  }

  const statusJson = typeof record.statusJson === 'string' ? record.statusJson : '';
  const statusHash = typeof record.statusHash === 'string' ? record.statusHash : '';

  const capacityBytes = asNumber(record.capacityBytes);
  const usedBytes = asNumber(record.usedBytes);
  const uplinkKbps = asNumber(record.uplinkKbps);
  const servedBytes24h = asNumber(record.servedBytes24h);
  const updatedAt = asNumber(record.updatedAt);
  if (
    capacityBytes === null ||
    usedBytes === null ||
    uplinkKbps === null ||
    servedBytes24h === null ||
    updatedAt === null
  ) {
    return null;
  }

  return {
    v: ANNOUNCEMENT_VERSION,
    relayPubkey: record.relayPubkey.toLowerCase(),
    regions,
    capacityBytes,
    usedBytes,
    uplinkKbps,
    paused: record.paused === true || record.paused === 'true',
    pausedReason: typeof record.pausedReason === 'string' ? record.pausedReason : null,
    servedBytes24h,
    updatedAt,
    statusHash,
    statusJson,
    signature: record.signature,
  };
}

/**
 * Verify an announcement with the app's existing secp256k1 Schnorr verifier.
 *
 * Reuses `identity/signing.verify` rather than a parallel implementation so the
 * relay and the app cannot drift onto different schemes.
 */
export function verifyAnnouncement(announcement: RelayAnnouncement): boolean {
  // The status payload must hash to what was signed, otherwise a reader could swap
  // the dashboard's numbers under a valid signature.
  if (announcement.statusHash) {
    const hash = bytesToHex(sha256Bytes(announcement.statusJson ?? ''));
    if (hash !== announcement.statusHash) return false;
  }

  try {
    return verify(
      announcementPayload(announcement),
      announcement.signature,
      announcement.relayPubkey,
    );
  } catch {
    return false;
  }
}

/**
 * Is this announcement still describing reality?
 *
 * A clock-skewed future timestamp is rejected: without that check a relay whose
 * clock runs a day fast would count as covered forever.
 */
export function isAnnouncementFresh(
  announcement: Pick<RelayAnnouncement, 'updatedAt'>,
  now: number,
  ttlMs: number = ANNOUNCEMENT_TTL_MS,
): boolean {
  const updatedAt = Number(announcement.updatedAt);
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return false;
  if (updatedAt > now + ttlMs) return false;
  return now - updatedAt <= ttlMs;
}
