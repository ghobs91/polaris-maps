/** Capture cadence preset. `threeD` is the denser, wider-FOV mode. */
export type StreetViewCaptureMode = 'standard' | 'threeD';

export type StreetViewDriveStatus =
  | 'recording'
  | 'pending'
  | 'uploading'
  | 'complete'
  | 'partial'
  | 'deleted';

/** Delivery state for one platform on one capture. */
export type StreetViewTargetStatus = 'pending' | 'uploading' | 'uploaded' | 'failed' | 'skipped';

/**
 * Which perspective a frame holds. `wide` is the Mapillary sequence (street
 * context, one frame per capture point). `detail` is the paired telephoto
 * frame of the same point, kept in its own stream so it never lands in the
 * middle of the context sequence.
 */
export type StreetViewCaptureStream = 'wide' | 'detail';

/**
 * Capture one detail frame per N wide frames. Wide frames are distance-gated
 * (3 m in town, 20 m on the highway), so this is ~15-100 m of detail coverage,
 * while only one tick in N pays the extra capture latency.
 */
export const STREET_VIEW_DETAIL_EVERY_NTH = 5;

export type StreetViewUploadTarget = 'mapillary';

export interface StreetViewDrive {
  id: string;
  startedAt: number;
  endedAt: number | null;
  status: StreetViewDriveStatus;
  captureCount: number;
  bytes: number;
  error: string | null;
  createdAt: number;
}

export interface StreetViewCapture {
  id: string;
  driveId: string;
  localUri: string;
  lat: number;
  lng: number;
  altitude: number | null;
  /** True-north camera heading, when known. */
  heading: number | null;
  speedMps: number | null;
  capturedAt: number;
  width: number;
  height: number;
  bytes: number;
  imageHash: string | null;
  blurred: boolean;
  stream: StreetViewCaptureStream;
  /** For a `detail` frame, the `wide` frame it was captured with. */
  pairId: string | null;
  mapillaryStatus: StreetViewTargetStatus;
  mapillaryFileHandle: string | null;
  mapillaryImageId: string | null;
  error: string | null;
  createdAt: number;
}

export interface StreetViewDriveSummary {
  drive: StreetViewDrive;
  captures: StreetViewCapture[];
  totalBytes: number;
  /** True when every captured image is landscape. */
  allLandscape: boolean;
}

export interface StreetViewUploadBatch {
  id: string;
  driveId: string;
  target: StreetViewUploadTarget;
  remoteBatchId: string | null;
  status: 'pending' | 'uploading' | 'complete' | 'partial' | 'failed';
  total: number;
  uploaded: number;
  failed: number;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Raw GPS fix published by the navigation tracking pipeline. */
export interface StreetViewFix {
  lat: number;
  lng: number;
  altitude: number | null;
  heading: number | null;
  speedMps: number;
  accuracyMeters: number | null;
  timestamp: number;
}

/** Speed at which Mapillary's mobile apps switch from urban to highway spacing. */
export const STREET_VIEW_HIGHWAY_SPEED_MPS = 50 / 3.6;

/** Above this speed Mapillary's apps lock focus at infinity to stop AF hunting. */
export const STREET_VIEW_INFINITY_FOCUS_SPEED_MPS = 10 * 0.44704;

export interface StreetViewCaptureConfig {
  /** Frame spacing below the highway speed, matching the Mapillary app's urban 3 m. */
  urbanDistanceMeters: number;
  /** Frame spacing at or above the highway speed, matching the Mapillary app's 20 m. */
  highwayDistanceMeters: number;
  minIntervalMs: number;
  minSpeedMps: number;
  maxAccuracyMeters: number;
  quality: number;
}

export const STREET_VIEW_MODE_CONFIG: Record<StreetViewCaptureMode, StreetViewCaptureConfig> = {
  standard: {
    urbanDistanceMeters: 3,
    highwayDistanceMeters: 20,
    // At 3 m spacing the camera, not the clock, sets the cadence. This floor
    // only debounces duplicate GPS ticks.
    minIntervalMs: 250,
    // Skip a parked car, but keep covering stop-and-go traffic: the Mapillary
    // app captures every 3 m at any moving speed, not just above 14 km/h.
    minSpeedMps: 1.5,
    maxAccuracyMeters: 50,
    quality: 0.7,
  },
  threeD: {
    urbanDistanceMeters: 3,
    highwayDistanceMeters: 20,
    minIntervalMs: 250,
    minSpeedMps: 1.5,
    maxAccuracyMeters: 50,
    quality: 0.9,
  },
};

export const STREET_VIEW_MAX_STORAGE_BYTES = 2 * 1024 * 1024 * 1024;
export const STREET_VIEW_MIN_FREE_BYTES = 500 * 1024 * 1024;
