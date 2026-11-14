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
 *   - the device must have room for the pack plus the expanded tile tree (big
 *     regions stay a manual choice only because of what they cost the device,
 *     not because of an arbitrary size ceiling),
 *   - the link must be unmetered unless the user opted into cellular,
 *   - the viewport must have settled (no downloading while panning across a
 *     continent), and a region is not retried after a failure this session.
 *
 * The policy is pure; the coordinator only supplies state and side effects.
 */

// ── Tunables ─────────────────────────────────────────────────────────

/** Viewport must be still for this long before a region is considered. */
export const AUTO_DOWNLOAD_SETTLE_MS = 4_000;

/**
 * Free space required, as a multiple of the pack size.
 *
 * A pack briefly occupies two copies: the downloaded `tiles.pmtiles` archive
 * and the `{z}/{x}/{y}.pbf` tree expanded from it, before the archive is
 * deleted. So the real requirement is `packSize` for the archive plus the
 * expanded tree, plus headroom for everything else on the device. 2.5 covers
 * that with margin; anything less risks a download that fills the disk halfway
 * through expansion.
 *
 * This replaces a fixed 150 MB cap. That number was not derived from anything —
 * it stood in for two different concerns (consent and device capacity) and was
 * the only thing keeping the unpacker from being asked for more than it could
 * hold in memory. The unpacker now streams (`backend/pmtiles.mjs`), so what is
 * left to check is genuinely free space.
 */
export const AUTO_DOWNLOAD_DISK_HEADROOM = 2.5;

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
  /** Free space on the device in bytes, or null when it could not be read. */
  freeBytes: number | null;
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
  | 'size-unknown'
  | 'disk-unknown'
  | 'insufficient-disk'
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
  // Never auto-download blind: without a size or a free-space reading there is
  // no way to know whether the download fits.
  if (ctx.packSizeBytes == null) return { start: false, reason: 'size-unknown' };
  if (ctx.freeBytes == null) return { start: false, reason: 'disk-unknown' };
  if (ctx.freeBytes < ctx.packSizeBytes * AUTO_DOWNLOAD_DISK_HEADROOM) {
    return { start: false, reason: 'insufficient-disk' };
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
