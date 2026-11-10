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
  /**
   * Canonical Hyperdrive key of the region pack — shared by every seeder. Null
   * until the pack has been seeded on this device.
   */
  driveKey: string | null;
  geocodingUrl: string | null;
  /** URL of the region's gzipped Overture places extract, when published. */
  placesUrl: string | null;
  /** Compressed size of the Overture places extract, for download progress. */
  placesSizeBytes: number | null;
  /**
   * URL of the region's gzipped on-device POI index (`search.sqlite`).
   *
   * Optional: packs published before the index existed omit it, and the app
   * then answers from the network. When present, the index makes POI search
   * fully local for the region. Hosted by whichever community/third-party
   * origin serves the rest of the pack — never by the project.
   */
  searchIndexUrl?: string | null;
  /** Compressed size of the POI index, for download progress. */
  searchIndexSizeBytes?: number | null;
  /** URL of the region's gzipped transit index (`transit.sqlite`). Optional. */
  transitIndexUrl?: string | null;
  /** Compressed size of the transit index, for download progress. */
  transitIndexSizeBytes?: number | null;
  /** OpenFreeMap tile build version (date-stamp from tile URL, e.g. "20260422_001001_pt"). */
  tileVersion: string | null;
}

export type RegionDownloadStatus = 'none' | 'downloading' | 'complete' | 'failed';
