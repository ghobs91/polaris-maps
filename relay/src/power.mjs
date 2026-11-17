/**
 * Power and link state, and the pause matrix.
 *
 * A laptop on battery is the same situation as a phone: not a seeder. The
 * difference is that the desktop user can choose to seed anyway, so this module
 * answers "may we serve right now, and if not, why" rather than assuming a
 * policy. Every pause carries a human-readable `reason`, because "why did my Mac
 * stop seeding" is the support question this design will actually generate.
 *
 * Parsing is split from execution so it can be tested against real `pmset`
 * output without running `pmset`.
 */

import { execFile } from 'node:child_process';

/**
 * Parse `pmset -g ps` ("Now drawing from 'AC Power'" / "'Battery Power'").
 *
 * @param {string} text
 * @returns {'ac' | 'battery' | 'unknown'}
 */
export function parsePowerSource(text) {
  const match = /Now drawing from '([^']+)'/.exec(text ?? '');
  if (!match) return 'unknown';
  const source = match[1].toLowerCase();
  if (source.includes('battery')) return 'battery';
  if (source.includes('ac')) return 'ac';
  return 'unknown';
}

/**
 * Parse `pmset -g` for Low Power Mode.
 *
 * The key is `lowpowermode` and the value is `0`/`1`; older systems omit it
 * entirely, which reads as "off" rather than "unknown" because the pausing
 * decision only needs the positive signal.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function parseLowPowerMode(text) {
  const match = /^\s*lowpowermode\s+(\d+)\s*$/m.exec(text ?? '');
  return match ? match[1] === '1' : false;
}

/**
 * Decide whether the relay may serve.
 *
 * @param {object} input
 * @param {'ac' | 'battery' | 'unknown'} input.power
 * @param {boolean} input.lowPowerMode
 * @param {boolean} input.metered whether the active interface is expensive/constrained
 * @param {boolean} input.seedOnBattery
 * @param {boolean} input.seedOnMetered
 * @param {boolean} input.manuallyPaused  `ctl pause`
 * @param {{ allowed: boolean, reason: string | null }} input.egress
 * @returns {{ serving: boolean, reason: string | null }}
 */
export function decideServing({
  power,
  lowPowerMode,
  metered,
  seedOnBattery,
  seedOnMetered,
  manuallyPaused,
  egress,
}) {
  if (manuallyPaused) return { serving: false, reason: 'paused by user' };
  if (!egress.allowed) return { serving: false, reason: egress.reason };

  if (lowPowerMode) {
    return { serving: false, reason: 'Low Power Mode is on' };
  }

  // 'unknown' is treated as battery: refuse to serve rather than risk a user's
  // tethered allowance because `pmset` output changed shape.
  if (power !== 'ac' && !seedOnBattery) {
    return {
      serving: false,
      reason: power === 'battery' ? 'on battery power' : 'power source unknown',
    };
  }

  if (metered && !seedOnMetered) {
    return { serving: false, reason: 'metered or expensive network connection' };
  }

  return { serving: true, reason: null };
}

/** Run a command, resolving to stdout (empty string on failure). */
function run(command, args) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 5_000 }, (err, stdout) => {
      resolve(err ? '' : String(stdout));
    });
  });
}

/**
 * Read live power state.
 *
 * `pmset` is the only signal available without native modules or entitlements,
 * which is why it is used rather than IOKit. Non-macOS hosts report AC, so the
 * daemon runs normally on a Linux box where `pmset` does not exist.
 *
 * @param {{ platform?: NodeJS.Platform }} [options]
 * @returns {Promise<{ power: 'ac' | 'battery' | 'unknown', lowPowerMode: boolean }>}
 */
export async function readPowerState({ platform = process.platform } = {}) {
  if (platform !== 'darwin') return { power: 'ac', lowPowerMode: false };

  const [ps, general] = await Promise.all([run('pmset', ['-g', 'ps']), run('pmset', ['-g'])]);
  return { power: parsePowerSource(ps), lowPowerMode: parseLowPowerMode(general) };
}
