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

export interface StreetViewCaptureConfig {
  distanceMeters: number;
  minIntervalMs: number;
  minSpeedMps: number;
  maxAccuracyMeters: number;
  quality: number;
  /** Preferred still size; null means the camera default / full resolution. */
  pictureSize: string | null;
}

export const STREET_VIEW_MODE_CONFIG: Record<StreetViewCaptureMode, StreetViewCaptureConfig> = {
  standard: {
    distanceMeters: 20,
    minIntervalMs: 1500,
    minSpeedMps: 4,
    maxAccuracyMeters: 50,
    quality: 0.8,
    pictureSize: '1920x1080',
  },
  threeD: {
    distanceMeters: 8,
    minIntervalMs: 900,
    minSpeedMps: 4,
    maxAccuracyMeters: 50,
    quality: 0.9,
    pictureSize: null,
  },
};

export const STREET_VIEW_MAX_STORAGE_BYTES = 2 * 1024 * 1024 * 1024;
export const STREET_VIEW_MIN_FREE_BYTES = 500 * 1024 * 1024;
