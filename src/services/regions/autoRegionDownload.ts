/**
 * Automatic region download for the area the user is looking at.
 *
 * A downloaded region renders from local bytes, so this is what keeps the
 * shared OpenFreeMap tile servers out of the hot path for ordinary use: on
 * first open the user is panned to their location, and the region containing
 * it starts downloading on its own.
 *
 * Downloading hundreds of megabytes without being asked is hostile, so the
 * decision is deliberately conservative:
 *
 *   - the user must have auto-download enabled (on by default),
 *   - the point must fall inside a catalog region that is not already
 *     downloaded or downloading,
 *   - the pack must be under the size cap (big regions stay a manual choice),
 *   - the link must be unmetered unless the user opted into cellular,
 *   - the viewport must have settled (no downloading while panning across a
 *     continent), and a region is not retried after a failure this session.
 *
 * The policy is pure; the coordinator only supplies state and side effects.
 */

// ── Tunables ─────────────────────────────────────────────────────────

/** Viewport must be still for this long before a region is considered. */
export const AUTO_DOWNLOAD_SETTLE_MS = 4_000;

/** Packs larger than this are never auto-downloaded (manual choice only). */
export const AUTO_DOWNLOAD_MAX_BYTES = 150 * 1024 * 1024;

/** Do not retry a region that failed this session. */
export const AUTO_DOWNLOAD_MAX_ATTEMPTS = 1;

// ── Types ────────────────────────────────────────────────────────────

export interface AutoDownloadContext {
  /** Auto-download enabled in settings. */
  enabled: boolean;
  /** Id of the catalog region containing the point, or null when outside. */
  regionId: string | null;
  /** Pack size in bytes, when the catalog knows it. */
  packSizeBytes: number | null;
  /** Region already downloaded. */
  downloaded: boolean;
  /** Region currently downloading (this or another one). */
  downloading: boolean;
  /** Connection is cellular or the OS flags it expensive. */
  metered: boolean;
  /** User allowed region downloads over cellular. */
  allowMetered: boolean;
  /** Attempts already made for this region this session. */
  attempts: number;
  /** Viewport has been still for at least AUTO_DOWNLOAD_SETTLE_MS. */
  settled: boolean;
}

export type AutoDownloadDecision =
  | { start: true; regionId: string; reason: 'initial' }
  | { start: false; reason: AutoDownloadSkipReason };

export type AutoDownloadSkipReason =
  | 'disabled'
  | 'no-region'
  | 'already-downloaded'
  | 'already-downloading'
  | 'not-settled'
  | 'too-large'
  | 'metered'
  | 'attempted';

// ── Policy (pure) ────────────────────────────────────────────────────

/** Decide whether the region under the viewport should start downloading. */
export function decideAutoDownload(ctx: AutoDownloadContext): AutoDownloadDecision {
  if (!ctx.enabled) return { start: false, reason: 'disabled' };
  if (!ctx.regionId) return { start: false, reason: 'no-region' };
  if (ctx.downloaded) return { start: false, reason: 'already-downloaded' };
  if (ctx.downloading) return { start: false, reason: 'already-downloading' };
  if (!ctx.settled) return { start: false, reason: 'not-settled' };
  if (ctx.attempts >= AUTO_DOWNLOAD_MAX_ATTEMPTS) return { start: false, reason: 'attempted' };
  // An unknown size is treated as too large: never auto-download blind.
  if (ctx.packSizeBytes == null || ctx.packSizeBytes > AUTO_DOWNLOAD_MAX_BYTES) {
    return { start: false, reason: 'too-large' };
  }
  if (ctx.metered && !ctx.allowMetered) return { start: false, reason: 'metered' };
  return { start: true, regionId: ctx.regionId, reason: 'initial' };
}

/** Human-readable reason, for the diagnostics log. */
export function describeDecision(decision: AutoDownloadDecision): string {
  return decision.start
    ? `auto-download ${decision.regionId}`
    : `skip auto-download: ${decision.reason}`;
}
