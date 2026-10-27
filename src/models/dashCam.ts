/** One segment of the rolling dash-cam buffer. */
export interface DashCamClip {
  id: string;
  localUri: string;
  /** Epoch ms when recording of this segment started. */
  startedAt: number;
  durationMs: number;
  bytes: number;
  createdAt: number;
}

export interface DashCamTotals {
  clips: number;
  bytes: number;
  durationMs: number;
}

/** Caps applied to the rolling buffer; whichever is exceeded first wins. */
export interface DashCamRetention {
  maxMinutes: number;
  maxBytes: number;
}
