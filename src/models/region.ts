export interface Region {
  id: string;
  name: string;
  bounds: {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
  };
  pmtilesTxId: string | null;
  routingGraphTxId: string | null;
  geocodingDbTxId: string | null;
  version: string;
  downloadStatus: RegionDownloadStatus;
  tilesSizeBytes: number | null;
  routingSizeBytes: number | null;
  geocodingSizeBytes: number | null;
  downloadedAt: number | null;
  lastUpdated: number | null;
  driveKey: string | null;
}

export type RegionDownloadStatus = 'none' | 'downloading' | 'complete' | 'failed';
