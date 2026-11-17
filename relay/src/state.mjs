/**
 * Relay state: pinned regions and usage counters.
 *
 * Small, hand-inspectable JSON files rather than SQLite: the relay must be
 * debuggable by a user who is deciding whether to trust it with their bandwidth,
 * and a `cat state/seeds.json` is the whole answer.
 *
 * Writes are atomic (temp file + rename) because a killed relay that leaves a
 * truncated `seeds.json` would silently stop seeding everything.
 */

import fs from 'node:fs';
import path from 'node:path';

/** @typedef {{ regionId: string, version: string, driveKey: string, pinnedAt: number }} SeedPin */

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file, value) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/**
 * Load pinned regions.
 *
 * A pin without a `driveKey` is dropped: nothing may be authored from a pin, and
 * a pin that cannot name a canonical key cannot be seeded read-only. Dropping it
 * (instead of authoring) is what keeps the relay from ever creating a competing
 * pack.
 *
 * @param {string} file
 * @returns {{ pins: SeedPin[], dropped: number }}
 */
export function loadSeeds(file) {
  const raw = readJson(file, { pins: [] });
  const pins = Array.isArray(raw.pins) ? raw.pins : [];
  /** @type {SeedPin[]} */
  const valid = [];
  let dropped = 0;

  for (const pin of pins) {
    if (
      pin &&
      typeof pin.regionId === 'string' &&
      pin.regionId.length > 0 &&
      typeof pin.driveKey === 'string' &&
      /^[0-9a-f]{64}$/i.test(pin.driveKey)
    ) {
      valid.push({
        regionId: pin.regionId,
        version: typeof pin.version === 'string' ? pin.version : 'unknown',
        driveKey: pin.driveKey.toLowerCase(),
        pinnedAt: Number(pin.pinnedAt) || 0,
      });
    } else {
      dropped += 1;
    }
  }

  return { pins: valid, dropped };
}

/** @param {string} file @param {SeedPin[]} pins */
export function saveSeeds(file, pins) {
  writeJsonAtomic(file, { pins });
}

/**
 * Load the usage/demand state.
 *
 * @param {string} file
 * @returns {{ usage: { month: string, bytes: number }, demand: Record<string, { lastRequestedAt: number }>, servedBytes24h: number }}
 */
export function loadUsage(file) {
  const raw = readJson(file, {});
  const usage = raw.usage && typeof raw.usage === 'object' ? raw.usage : { month: '', bytes: 0 };
  const demand = raw.demand && typeof raw.demand === 'object' ? raw.demand : {};
  return {
    usage: { month: String(usage.month ?? ''), bytes: Number(usage.bytes) || 0 },
    demand,
    servedBytes24h: Number(raw.servedBytes24h) || 0,
  };
}

/** @param {string} file @param {ReturnType<typeof loadUsage>} state */
export function saveUsage(file, state) {
  writeJsonAtomic(file, state);
}

/**
 * Record a `ctl pin` invocation.
 *
 * Re-pinning an existing region updates the key and leaves `pinnedAt` alone, so
 * the age of a pin stays meaningful across a data-version change.
 *
 * @param {SeedPin[]} pins
 * @param {{ regionId: string, version?: string, driveKey: string }} input
 * @param {number} now
 * @returns {{ pins: SeedPin[], pin: SeedPin }}
 */
export function applyPin(pins, { regionId, version, driveKey }, now) {
  const existing = pins.find((p) => p.regionId === regionId);
  const pin = {
    regionId,
    version: version ?? existing?.version ?? 'unknown',
    driveKey: driveKey.toLowerCase(),
    pinnedAt: existing?.pinnedAt || now,
  };
  return { pins: [...pins.filter((p) => p.regionId !== regionId), pin], pin };
}

/** @param {SeedPin[]} pins @param {string} regionId */
export function applyUnpin(pins, regionId) {
  return pins.filter((p) => p.regionId !== regionId);
}
