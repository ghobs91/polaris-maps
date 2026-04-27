export interface Region {
  id: string;
  name: string;
  bounds: {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
  };
  version: string;
  downloadStatus: RegionDownloadStatus;
  tilesSizeBytes: number | null;
  routingSizeBytes: number | null;
  geocodingSizeBytes: number | null;
  downloadedAt: number | null;
  lastUpdated: number | null;
  driveKey: string | null;
  geocodingUrl: string | null;
  /** OpenFreeMap tile build version (date-stamp from tile URL, e.g. "20260422_001001_pt"). */
  tileVersion: string | null;
}

export type RegionDownloadStatus = 'none' | 'downloading' | 'complete' | 'failed';
