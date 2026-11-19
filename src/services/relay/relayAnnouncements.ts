import { storage } from '../storage/mmkv';
import { logDiagnostic } from '../diagnostics/diagnosticsLog';
import {
  isAnnouncementFresh,
  parseAnnouncement,
  verifyAnnouncement,
  type RelayAnnouncement,
} from './announcement';
import { relayCoverageFor, type RelayCoverage } from './coverage';

/**
 * Relay announcements: discovery, verification, persistence, and coverage lookup.
 *
 * Reads the same gossip namespace the relay publishes to
 * (`polaris/relays/<relayPubkey>`) using the app's existing Gun instance. Nothing
 * here writes: publishing an announcement is the relay's job, and a phone must
 * never be able to claim it is a desktop.
 *
 * Verify-before-merge, bounded persistence, and a TTL, in the shape of
 * `regionManifestGossip.ts` — the same open-write-surface problem, so the same
 * three defences.
 */

const STORE_KEY = 'relay_announcements_v1';
/** Total persisted announcements kept (each is small). */
const STORE_MAX = 32;

/** Minimal Gun surface used here (injectable so it can be faked in tests). */
export interface AnnouncementGunNode {
  map(): AnnouncementGunNode;
  on(cb: (value: unknown, key: string) => void, opt?: boolean): void;
  get(key: string): AnnouncementGunNode;
}
export interface AnnouncementGun {
  get(key: string): AnnouncementGunNode;
}

let announcements: RelayAnnouncement[] = loadPersisted();
let unsubscribe: (() => void) | null = null;

function loadPersisted(): RelayAnnouncement[] {
  try {
    const raw = storage.getString(STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return parsed
      .map((value) => parseAnnouncement(value))
      .filter((value): value is RelayAnnouncement => value != null)
      .filter((value) => verifyAnnouncement(value) && isAnnouncementFresh(value, now));
  } catch {
    return [];
  }
}

function persist(): void {
  try {
    const trimmed = [...announcements]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, STORE_MAX);
    storage.set(STORE_KEY, JSON.stringify(trimmed));
  } catch {
    /* persistence is best-effort; the in-memory set still works this session */
  }
}

/**
 * Merge one untrusted record.
 *
 * Verifies before merging, and keeps the newest record per relay key so a replay
 * of an old announcement cannot downgrade a fresh one.
 */
export function ingestAnnouncement(value: unknown, now: number = Date.now()): boolean {
  const parsed = parseAnnouncement(value);
  if (!parsed) return false;
  if (!verifyAnnouncement(parsed)) {
    logDiagnostic('relay', 'warn', 'Rejected relay announcement with a bad signature', {
      relayPubkey: parsed.relayPubkey,
    });
    return false;
  }
  if (!isAnnouncementFresh(parsed, now)) return false;

  const existing = announcements.find((a) => a.relayPubkey === parsed.relayPubkey);
  if (existing && existing.updatedAt >= parsed.updatedAt) return false;

  announcements = [...announcements.filter((a) => a.relayPubkey !== parsed.relayPubkey), parsed];
  persist();
  return true;
}

/** Current verified, unexpired announcements (newest first). */
export function getAnnouncements(now: number = Date.now()): RelayAnnouncement[] {
  return announcements
    .filter((a) => isAnnouncementFresh(a, now))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Coverage for one region, from every announcement this device has seen. */
export function getRelayCoverage(regionId: string, now: number = Date.now()): RelayCoverage {
  return relayCoverageFor(getAnnouncements(now), regionId, now);
}

/**
 * Relays that announce they hold this region and are serving right now.
 *
 * Used by the P2P source picker to say *who* is out there before a search starts —
 * "searching the mesh" with no context is indistinguishable from a hang.
 */
export function relaysSeedingRegion(
  regionId: string,
  now: number = Date.now(),
): RelayAnnouncement[] {
  return getAnnouncements(now).filter(
    (relay) => !relay.paused && relay.regions.some((region) => region.regionId === regionId),
  );
}

/** True when any relay announced this region and is currently serving it. */
export function isRegionRelayCovered(regionId: string, now: number = Date.now()): boolean {
  return getRelayCoverage(regionId, now).healthy;
}

/**
 * Subscribe to the gossip namespace.
 *
 * `getGun` is injected so this module stays free of the Gun/MMKV boot order and
 * can be tested with a fake. Returns a teardown function.
 */
export function subscribeRelayAnnouncements(gun: AnnouncementGun): () => void {
  unsubscribe?.();
  let active = true;

  gun
    .get('polaris')
    .get('relays')
    .map()
    .on((value) => {
      if (!active || !value) return;
      ingestAnnouncement(value);
    });

  unsubscribe = () => {
    active = false;
    unsubscribe = null;
  };
  return unsubscribe;
}

/** Stop listening (app backgrounded, or tests tearing down). */
export function stopRelayAnnouncementSync(): void {
  unsubscribe?.();
}

/** Reset in-memory state; tests only. */
export function __resetRelayAnnouncementsForTest(): void {
  announcements = [];
  unsubscribe = null;
}
