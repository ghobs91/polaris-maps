/**
 * Persistent, on-device ledger of Overture places already submitted to OSM.
 *
 * The Overpass existence check can only be as good as the network and the
 * community's data. This ledger adds a second, authoritative layer: once this
 * device has created an OSM node for an Overture place (keyed by its Overture
 * GERS id), we never submit it again — across selections, screens, sessions and
 * restarts, and even while offline.
 */
import { storage } from '../storage/mmkv';

const LEDGER_KEY = 'osm_overture_seed_ledger';
const LEDGER_MAX_ENTRIES = 2000;

interface LedgerEntry {
  /** OSM node id assigned when the place was created, when known. */
  nodeId?: number;
  /** Epoch millis of the submission. */
  at: number;
}

type Ledger = Record<string, LedgerEntry>;

function load(): Ledger {
  try {
    const raw = storage.getString(LEDGER_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Ledger;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function save(ledger: Ledger): void {
  try {
    storage.set(LEDGER_KEY, JSON.stringify(ledger));
  } catch {
    /* persistence is best-effort */
  }
}

/** True when this Overture place id was already submitted from this device. */
export function hasSeededOverturePlace(overtureId: string): boolean {
  if (!overtureId) return false;
  return Object.prototype.hasOwnProperty.call(load(), overtureId);
}

/** Record that an Overture place was submitted, so we never resubmit it. */
export function recordSeededOverturePlace(overtureId: string, nodeId?: number): void {
  if (!overtureId) return;
  const ledger = load();
  ledger[overtureId] = { nodeId, at: Date.now() };

  const entries = Object.entries(ledger);
  if (entries.length > LEDGER_MAX_ENTRIES) {
    entries.sort((a, b) => a[1].at - b[1].at);
    for (const [key] of entries.slice(0, entries.length - LEDGER_MAX_ENTRIES)) {
      delete ledger[key];
    }
  }
  save(ledger);
}

/** Clear the ledger (exposed for tests). */
export function clearSeedLedger(): void {
  try {
    storage.delete(LEDGER_KEY);
  } catch {
    /* ignore */
  }
}
