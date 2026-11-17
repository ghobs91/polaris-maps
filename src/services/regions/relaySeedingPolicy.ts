/**
 * Should this device seed a region it just downloaded?
 *
 * Until now the answer was always yes: `autoSeedRegion` called `seedRegion` on
 * every download, and the only thing that ever unseeded a pack was deleting the
 * region. On a phone that means a 50–400 MB pack seeded from a cellular plan and
 * a battery budget, for an audience it can only serve while foregrounded —
 * `seedDiagnostics.ts` exists to measure how weak that is.
 *
 * The desktop relay exists to make the answer "no". This policy is where that
 * trade is made explicit and testable, in the same shape as
 * `peerDownloadPolicy` and `packSourcePolicy`.
 *
 * Nothing here touches the network or storage: the caller passes observed facts.
 */

/**
 * What the user asked for in settings. Declared once, in the settings store, and
 * imported as a type only so this module stays free of the MMKV boot order.
 */
export type { DeviceSeedingPreference } from '../../stores/settingsStore';

import type { DeviceSeedingPreference } from '../../stores/settingsStore';

export interface LocalSeedingInput {
  /** A verified, fresh relay announcement covers this region. */
  relayCovers: boolean;
  /** …and that relay reports itself serving with room. */
  relayHealthy: boolean;
  userPref: DeviceSeedingPreference;
  power: 'charging' | 'battery';
  link: 'unmetered' | 'metered' | 'none';
  /** Free space divided by what this region needs. `< 1` cannot fit. */
  freeDiskRatio: number;
}

export interface LocalSeedingDecision {
  seed: boolean;
  /** Shown in the UI and written to diagnostics — never a bare boolean. */
  reason: string;
}

/** Below this the pack plus its replica would thrash the device. */
export const SEED_DISK_HEADROOM_RATIO = 1.5;

/**
 * Decide whether to seed locally.
 *
 * Order matters: an explicit preference beats everything (it is the escape hatch
 * that makes this change reversible), then relay coverage, then the fallback
 * conditions for an uncovered region — which reproduce today's behaviour so a
 * phone-only mesh is unaffected.
 */
export function shouldSeedLocallyOnDevice(input: LocalSeedingInput): LocalSeedingDecision {
  if (input.userPref === 'never') {
    return { seed: false, reason: 'seeding disabled for this device' };
  }
  if (input.userPref === 'always') {
    return { seed: true, reason: 'seeding enabled for this device' };
  }

  if (input.relayCovers && input.relayHealthy) {
    return { seed: false, reason: 'a desktop relay is seeding this region' };
  }

  // From here down: no usable relay, so this device is the fallback. Be stricter
  // than "always", because nobody asked for this specifically.
  if (!input.freeDiskRatio || input.freeDiskRatio < SEED_DISK_HEADROOM_RATIO) {
    return { seed: false, reason: 'not enough free disk to seed a copy' };
  }
  if (input.link === 'none') {
    return { seed: false, reason: 'no network connection' };
  }
  if (input.link === 'metered') {
    return { seed: false, reason: 'metered connection' };
  }
  if (input.power === 'battery') {
    return { seed: false, reason: 'on battery power' };
  }

  return {
    seed: true,
    reason: input.relayCovers
      ? 'relay advertised the region but is not serving it'
      : 'no relay covers this region',
  };
}
