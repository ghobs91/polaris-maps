/**
 * Egress accounting and rate limiting.
 *
 * A relay that quietly saturates an uplink gets uninstalled, and an uninstalled
 * relay is worse than no relay — the phone's seeding policy assumed coverage. So
 * the limits here are hard stops rather than advisory: hitting the monthly cap
 * stops serving for the rest of the month, and it is reported as the pause reason
 * instead of looking like an idle relay.
 *
 * All of this is pure (no clock, no IO) so it is testable directly: callers pass
 * `now`.
 */

/** UTC month key used to bucket the egress counter. */
export function monthKey(now) {
  const d = new Date(now);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Roll the persisted counter over when the month changes.
 *
 * @param {{ month: string, bytes: number }} usage
 * @param {number} now epoch ms
 */
export function rollUsage(usage, now) {
  const month = monthKey(now);
  if (!usage || usage.month !== month) return { month, bytes: 0 };
  return { month, bytes: Math.max(0, Number(usage.bytes) || 0) };
}

/**
 * May this relay keep serving, given the egress counter?
 *
 * @param {{ month: string, bytes: number }} usage
 * @param {number} capBytes monthly cap; 0 disables
 * @param {number} now epoch ms
 * @returns {{ allowed: boolean, reason: string | null, usedBytes: number, capBytes: number }}
 */
export function checkEgress(usage, capBytes, now) {
  const rolled = rollUsage(usage, now);
  if (!capBytes || capBytes <= 0) {
    return { allowed: true, reason: null, usedBytes: rolled.bytes, capBytes: 0 };
  }
  const allowed = rolled.bytes < capBytes;
  return {
    allowed,
    reason: allowed ? null : `monthly egress cap reached (${rolled.bytes}/${capBytes} bytes)`,
    usedBytes: rolled.bytes,
    capBytes,
  };
}

/** Add served bytes to the counter, rolling the month if needed. */
export function recordEgress(usage, bytes, now) {
  const rolled = rollUsage(usage, now);
  return { month: rolled.month, bytes: rolled.bytes + Math.max(0, Number(bytes) || 0) };
}

/**
 * Token bucket for the burst rate cap.
 *
 * Deliberately simple and conservative: it reports whether a transfer of `bytes`
 * may proceed *now* and how long to wait otherwise. The daemon uses it to decide
 * whether to accept a connection at all, not to pace individual blocks — pacing
 * inside the replication stream would mean forking the seed core.
 */
export function createTokenBucket({ bytesPerSecond, capacityBytes }) {
  let tokens = capacityBytes;
  let last = 0;

  return {
    /**
     * @param {number} bytes
     * @param {number} now epoch ms
     * @returns {{ allowed: boolean, waitMs: number }}
     */
    take(bytes, now) {
      if (last === 0) last = now;
      const elapsedSec = Math.max(0, (now - last) / 1000);
      last = now;
      tokens = Math.min(capacityBytes, tokens + elapsedSec * bytesPerSecond);
      if (bytes <= tokens) {
        tokens -= bytes;
        return { allowed: true, waitMs: 0 };
      }
      const deficit = bytes - tokens;
      return { allowed: false, waitMs: Math.ceil((deficit / bytesPerSecond) * 1000) };
    },
    available() {
      return tokens;
    },
  };
}
