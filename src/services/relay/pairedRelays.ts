import { storage } from '../storage/mmkv';

/**
 * Relays this phone has deliberately paired with (the QR code).
 *
 * This is the third leg of the trust model, and it exists because of how manifests
 * are actually produced: the catalog advertises no signed manifests, so a relay acts
 * as the publisher for the packs it holds, signing them with its **own** identity.
 * That key cannot be in the app's compiled-in allowlist — it belongs to one user's
 * Mac — so the trust comes from the pairing instead, which is the moment the user
 * pointed a camera at that machine and said "this one".
 *
 * Scoped tight on purpose:
 *
 *   - only manifests signed by a relay the user paired are accepted this way;
 *   - a manifest still has to verify cryptographically, and its pack still has to
 *     match the catalog's per-asset checksums on download, so a paired relay can be
 *     offline or stale but cannot substitute different bytes.
 */

const STORE_KEY = 'paired_relays_v1';
/** Bounded: a handful of devices is normal, a thousand is an attack. */
const MAX_PAIRED_RELAYS = 8;

function readAll(): string[] {
  try {
    const raw = storage.getString(STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.toLowerCase())
      .filter((value) => /^[0-9a-f]{64}$/.test(value));
  } catch {
    return [];
  }
}

function writeAll(relays: string[]): void {
  try {
    storage.set(STORE_KEY, JSON.stringify(relays.slice(-MAX_PAIRED_RELAYS)));
  } catch {
    /* best effort: trust is re-established by pairing again */
  }
}

export function getPairedRelays(): string[] {
  return readAll();
}

/** Record a successful pairing. Idempotent. */
export function addPairedRelay(relayPubkey: string): void {
  const normalized = relayPubkey.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) return;
  const existing = readAll();
  if (existing.includes(normalized)) return;
  writeAll([...existing, normalized]);
}

export function removePairedRelay(relayPubkey: string): void {
  const normalized = relayPubkey.trim().toLowerCase();
  writeAll(readAll().filter((value) => value !== normalized));
}

export function isPairedRelay(relayPubkey: string): boolean {
  return readAll().includes(relayPubkey.trim().toLowerCase());
}

/** Test hook: forget every paired relay. */
export function __resetPairedRelaysForTest(): void {
  writeAll([]);
}
