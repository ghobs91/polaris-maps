/**
 * Demand tracking and eviction.
 *
 * The pack store is not a cache of "the regions someone downloaded once"; it is
 * a store of "the regions peers are actually asking for". Evicting by access
 * time on the *serving* side (rather than by install date) is what keeps a
 * 25 GiB budget useful: a region nobody has requested in a month is worth less
 * than one requested today, even if it was downloaded more recently.
 *
 * Pinned regions are never evicted. The alternative — evicting a pin to make room
 * — turns a budget overrun into a silent behaviour change ("why does it no longer
 * seed my region?"), so the daemon refuses the new work instead.
 *
 * Pure: callers pass `now` and the directory sizes they observed.
 */

/** @typedef {{ regionId: string, bytes: number, lastRequestedAt: number, pinned: boolean }} DriveEntry */

/**
 * Decide which drives must go to fit `incomingBytes` inside `budgetBytes`.
 *
 * @param {DriveEntry[]} drives
 * @param {{ budgetBytes: number, incomingBytes?: number, now: number, idleEvictionDays: number }} options
 * @returns {{ evict: string[], refused: boolean, reason: string | null, usedBytes: number }}
 */
export function planEviction(drives, { budgetBytes, incomingBytes = 0, now, idleEvictionDays }) {
  const usedBytes = drives.reduce((sum, d) => sum + d.bytes, 0);

  if (incomingBytes > 0 && usedBytes + incomingBytes > budgetBytes) {
    const pinnedBytes = drives.filter((d) => d.pinned).reduce((sum, d) => sum + d.bytes, 0);
    // Refuse rather than break a promise the user made by pinning.
    if (pinnedBytes + incomingBytes > budgetBytes) {
      return {
        evict: [],
        refused: true,
        reason:
          `cannot fit ${incomingBytes} incoming bytes plus ${pinnedBytes} pinned bytes ` +
          `inside the ${budgetBytes} byte budget`,
        usedBytes,
      };
    }
  }

  const idleMs = idleEvictionDays * 24 * 60 * 60 * 1000;
  const candidates = drives
    .filter((d) => !d.pinned)
    .map((d) => ({ ...d, idle: now - d.lastRequestedAt >= idleMs }))
    // Least recently requested first; a long-idle drive goes before a busy one.
    .sort((a, b) => a.lastRequestedAt - b.lastRequestedAt);

  /** @type {string[]} */
  const evict = [];
  let remaining = usedBytes;

  for (const candidate of candidates) {
    if (remaining + incomingBytes <= budgetBytes) break;
    evict.push(candidate.regionId);
    remaining -= candidate.bytes;
  }

  if (remaining + incomingBytes > budgetBytes) {
    return {
      evict,
      refused: true,
      reason: 'no unpinned region left to evict; raise the pack store budget',
      usedBytes,
    };
  }

  return { evict, refused: false, reason: null, usedBytes };
}

/**
 * Idle drives that should be dropped even without disk pressure.
 *
 * Keeping a 200 MB replica that nobody has asked for in a month is just noise in
 * the swarm: it advertises availability the phone will discover is slow.
 *
 * @param {DriveEntry[]} drives
 * @param {{ now: number, idleEvictionDays: number }} options
 * @returns {string[]}
 */
export function planIdleEviction(drives, { now, idleEvictionDays }) {
  const idleMs = idleEvictionDays * 24 * 60 * 60 * 1000;
  return drives
    .filter((d) => !d.pinned && now - d.lastRequestedAt >= idleMs)
    .map((d) => d.regionId);
}

/**
 * Merge observed peer counts into demand timestamps.
 *
 * Called on a timer with the seed core's status: a drive with peers is being
 * requested right now, so its demand timestamp moves. This is the closest thing
 * to "demand" available without instrumenting the replication stream, and it is
 * cheap.
 *
 * @param {Record<string, { lastRequestedAt: number }>} demand
 * @param {Array<{ regionId: string, peers: number }>} drives
 * @param {number} now
 * @returns {Record<string, { lastRequestedAt: number }>}
 */
export function touchDemand(demand, drives, now) {
  const next = { ...demand };
  for (const drive of drives) {
    const existing = next[drive.regionId] ?? { lastRequestedAt: 0 };
    next[drive.regionId] =
      drive.peers > 0 ? { lastRequestedAt: now } : { lastRequestedAt: existing.lastRequestedAt };
  }
  return next;
}
