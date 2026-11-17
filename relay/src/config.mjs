/**
 * Relay configuration: defaults, validation, and load/save.
 *
 * `validateConfig` is pure and total — a corrupt or hand-edited `config.json`
 * must never prevent the daemon from starting, because the failure mode of "the
 * relay silently does nothing" is indistinguishable from "the relay is working
 * and nobody asked it for anything". Every field is clamped to a sane range and
 * the reason for each rejection is returned rather than thrown.
 */

import fs from 'node:fs';

/** GiB → bytes, for readable defaults. */
const GiB = 1024 ** 3;
const GB = 1000 ** 3;

export const DEFAULT_CONFIG = Object.freeze({
  /** Disk budget for replicated pack blocks. */
  packStoreBytes: 25 * GiB,
  /** Monthly egress cap. `0` disables the cap (not recommended). */
  egressBytesPerMonth: 500 * GB,
  /** Burst rate cap, both directions. */
  maxBitsPerSecond: 10_000_000,
  /** Concurrent peer connections across all drives. */
  maxPeers: 32,
  /** Per-peer ceiling, so one greedy client cannot consume the aggregate. */
  maxBitsPerSecondPerPeer: 2_000_000,
  /**
   * Whether to keep seeding on battery power. Off by default — a laptop on
   * battery is exactly the situation a phone is in, which is the thing this
   * component exists to stop relying on. The user can enable it.
   */
  seedOnBattery: false,
  /** Whether to seed on an "expensive"/metered interface (tethered, hotspot). */
  seedOnMetered: false,
  /** Publish signed availability announcements on the Gun.js gossip channel. */
  publishAnnouncements: true,
  /** Refresh interval for announcements. */
  announceIntervalSec: 300,
  /** Stop seeding a drive that no peer has requested for this long. */
  idleEvictionDays: 30,
});

const LIMITS = {
  packStoreBytes: [1 * GiB, 2_000 * GiB],
  egressBytesPerMonth: [0, 10_000 * GB],
  maxBitsPerSecond: [128_000, 10_000_000_000],
  maxPeers: [1, 1_024],
  maxBitsPerSecondPerPeer: [64_000, 1_000_000_000],
  announceIntervalSec: [60, 86_400],
  idleEvictionDays: [1, 3_650],
};

/**
 * Validate and normalize a config object.
 *
 * @param {unknown} input parsed JSON (or anything)
 * @returns {{ config: typeof DEFAULT_CONFIG, warnings: string[] }}
 */
export function validateConfig(input) {
  const warnings = [];
  const config = { ...DEFAULT_CONFIG };
  if (input === null || typeof input !== 'object') {
    if (input !== undefined) warnings.push('config is not an object; using defaults');
    return { config, warnings };
  }

  const source = /** @type {Record<string, unknown>} */ (input);

  for (const key of Object.keys(DEFAULT_CONFIG)) {
    if (!(key in source)) continue;
    const value = source[key];
    const fallback = DEFAULT_CONFIG[key];

    if (typeof fallback === 'boolean') {
      if (typeof value === 'boolean') {
        config[key] = value;
      } else {
        warnings.push(`${key} must be a boolean; keeping ${fallback}`);
      }
      continue;
    }

    if (typeof fallback === 'number') {
      const numeric = typeof value === 'string' ? Number(value) : value;
      if (typeof numeric !== 'number' || !Number.isFinite(numeric)) {
        warnings.push(`${key} must be a number; keeping ${fallback}`);
        continue;
      }
      const [min, max] = LIMITS[key];
      if (numeric < min || numeric > max) {
        const clamped = Math.min(max, Math.max(min, numeric));
        warnings.push(`${key} out of range [${min}, ${max}]; clamped to ${clamped}`);
        config[key] = clamped;
      } else {
        config[key] = numeric;
      }
    }
  }

  for (const key of Object.keys(source)) {
    if (!(key in DEFAULT_CONFIG)) warnings.push(`unknown config key ignored: ${key}`);
  }

  return { config, warnings };
}

/**
 * Read config from disk, creating it with defaults when absent.
 *
 * A parse failure is not fatal: the daemon falls back to defaults and reports the
 * problem through `status`, so a typo degrades to default behaviour instead of a
 * crash loop.
 *
 * @param {string} configPath
 * @returns {{ config: typeof DEFAULT_CONFIG, warnings: string[], created: boolean }}
 */
export function loadConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    fs.mkdirSync(/** @type {string} */ (configPath.replace(/[/\\][^/\\]+$/, '')), {
      recursive: true,
    });
    fs.writeFileSync(configPath, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`);
    return { config: { ...DEFAULT_CONFIG }, warnings: [], created: true };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return { ...validateConfig(parsed), created: false };
  } catch (err) {
    return {
      config: { ...DEFAULT_CONFIG },
      warnings: [
        `config.json could not be parsed (${err instanceof Error ? err.message : String(err)}); using defaults`,
      ],
      created: false,
    };
  }
}
