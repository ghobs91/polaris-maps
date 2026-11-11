/**
 * Persistence for region-pack mirror health.
 *
 * Keeps the multi-origin policy in `mirrorSelector.ts` stateless: this module
 * owns the MMKV record and the rotation counter, and degrades to in-memory
 * state when storage is not available yet (early boot, tests).
 */

import {
  applyMirrorOutcome,
  orderSources,
  pruneMirrorHealth,
  type MirrorHealth,
} from './mirrorSelector';

/**
 * Storage handle, resolved lazily.
 *
 * Deliberately not a top-level import: this module is pulled in by
 * `routingGraphs` → `downloadService`, and importing MMKV eagerly would drag
 * `expo-crypto`/`expo-modules-core` into every suite that touches those files.
 */
function storable(): {
  getString: (k: string) => string | undefined;
  getNumber: (k: string) => number | undefined;
  set: (k: string, v: string | number) => void;
} | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getStorageSync } = require('../storage/mmkv') as typeof import('../storage/mmkv');
    return getStorageSync();
  } catch {
    return null;
  }
}

const HEALTH_KEY = 'regions.mirrorHealth.v1';
const ROTATION_KEY = 'regions.mirrorRotation.v1';

/** In-memory mirror of the persisted map; also the only store when MMKV is
 *  unavailable, so a transfer never blocks on storage. */
let cache: MirrorHealth | null = null;
let rotation: number | null = null;

function readJson(): MirrorHealth {
  if (cache) return cache;
  try {
    const raw = storable()?.getString(HEALTH_KEY);
    cache = raw ? (JSON.parse(raw) as MirrorHealth) : {};
  } catch {
    cache = {};
  }
  return cache;
}

function writeJson(next: MirrorHealth): void {
  cache = next;
  try {
    storable()?.set(HEALTH_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable — in-memory state still spreads load this session.
  }
}

function allocateRotation(): number {
  if (rotation == null) {
    try {
      rotation = storable()?.getNumber(ROTATION_KEY) ?? 0;
    } catch {
      rotation = 0;
    }
  }
  rotation = (rotation + 1) % 1_000_000;
  try {
    storable()?.set(ROTATION_KEY, rotation);
  } catch {
    // Non-fatal: rotation stays in memory.
  }
  return rotation;
}

export function getMirrorHealth(): MirrorHealth {
  return readJson();
}

export function recordMirrorSuccess(url: string): void {
  writeJson(pruneMirrorHealth(applyMirrorOutcome(readJson(), url, 'success')));
}

export function recordMirrorFailure(url: string): void {
  writeJson(pruneMirrorHealth(applyMirrorOutcome(readJson(), url, 'failure')));
}

/**
 * Order an asset's sources for the next transfer, applying load-distribution
 * rotation and failure cooldowns.
 */
export function orderMirrorSources(sources: ReadonlyArray<string>): string[] {
  return orderSources(sources, { health: readJson(), rotation: allocateRotation() });
}

/** Test hook: forget persisted state so a fresh policy starts clean. */
export function resetMirrorStateForTests(): void {
  cache = null;
  rotation = null;
}
