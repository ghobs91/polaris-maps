import type { DashCamClip, DashCamRetention } from '../../models/dashCam';

export interface DashCamPrunePlan {
  /** Clips that stay, oldest first. */
  keep: DashCamClip[];
  /** Clips to delete, oldest first. */
  drop: DashCamClip[];
}

/**
 * Decides which clips fall out of the rolling buffer.
 *
 * Both caps apply — a long drive in good light may hit the byte cap first,
 * while a low-bitrate drive hits the duration cap — so the oldest segments are
 * dropped until the buffer satisfies whichever limit is still exceeded.
 */
export function planDashCamPrune(
  clips: DashCamClip[],
  retention: DashCamRetention,
): DashCamPrunePlan {
  const ordered = [...clips].sort((a, b) => a.startedAt - b.startedAt);
  // A non-positive cap means "no limit" rather than "delete everything".
  const maxMs = retention.maxMinutes > 0 ? retention.maxMinutes * 60_000 : Number.POSITIVE_INFINITY;
  const maxBytes = retention.maxBytes > 0 ? retention.maxBytes : Number.POSITIVE_INFINITY;

  let bytes = ordered.reduce((sum, clip) => sum + clip.bytes, 0);
  let durationMs = ordered.reduce((sum, clip) => sum + clip.durationMs, 0);
  let dropCount = 0;

  while (dropCount < ordered.length && (bytes > maxBytes || durationMs > maxMs)) {
    bytes -= ordered[dropCount].bytes;
    durationMs -= ordered[dropCount].durationMs;
    dropCount += 1;
  }

  return { keep: ordered.slice(dropCount), drop: ordered.slice(0, dropCount) };
}
