import { isAnnouncementFresh, type RelayAnnouncement } from './announcement';

/**
 * Relay coverage: "is something always-on seeding this region right now?"
 *
 * Kept separate from the announcement model because it is a *policy* view of it
 * and the answer has to be conservative. The relay is a volunteer machine on
 * somebody's desk: an announcement that is stale, paused, or from a relay that is
 * itself out of room is not coverage, and treating it as coverage would make a
 * phone stop seeding a pack nobody is actually serving.
 */

export interface RelayCoverage {
  /** A relay claims this region and is fresh enough to believe. */
  covered: boolean;
  /** The relay says it is serving (not paused, has room). */
  healthy: boolean;
  /** Relay public key, when covered. */
  relayPubkey: string | null;
  /** Why coverage is absent, for the settings row. */
  reason: string | null;
}

const NOT_COVERED = (reason: string): RelayCoverage => ({
  covered: false,
  healthy: false,
  relayPubkey: null,
  reason,
});

/**
 * Resolve coverage for one region from every announcement the device has seen.
 *
 * Picks the healthiest relay rather than the freshest one: a stale-but-serving
 * relay from two minutes ago and a fresh-but-paused relay from ten seconds ago
 * describe the same machine, and the paused one is the current truth. So paused
 * announcements are dropped outright before freshness is considered.
 */
export function relayCoverageFor(
  announcements: RelayAnnouncement[],
  regionId: string,
  now: number,
  ttlMs?: number,
): RelayCoverage {
  const candidates = announcements
    .filter((relay) => isAnnouncementFresh(relay, now, ttlMs))
    .filter((relay) => relay.regions.some((region) => region.regionId === regionId))
    .sort((a, b) => b.updatedAt - a.updatedAt);

  if (candidates.length === 0) {
    return NOT_COVERED('no relay is advertising this region');
  }

  const serving = candidates.find((relay) => !relay.paused);
  if (!serving) {
    return NOT_COVERED(candidates[0].pausedReason ?? 'relay is paused');
  }

  // A relay with more claimed regions than free space will evict something to
  // make room; that is not coverage a phone should bet its seeding on.
  if (serving.capacityBytes > 0 && serving.usedBytes >= serving.capacityBytes) {
    return NOT_COVERED('relay is at its storage budget');
  }

  return {
    covered: true,
    healthy: true,
    relayPubkey: serving.relayPubkey,
    reason: null,
  };
}
