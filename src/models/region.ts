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
  /**
   * Per-file pack manifest (name, URL, mirrors, checksum, size).
   *
   * When present, downloads go through the resumable/mirror/delta path: an
   * asset whose local checksum already matches is skipped, and a partial
   * transfer resumes instead of restarting. Absent for packs published
   * before the manifest existed — the app then falls back to the per-URL
   * fields above.
   */
  assets?: RegionAsset[];
}

/** One file inside a region pack. */
export interface RegionAsset {
  /** File name relative to the region directory, e.g. `search.sqlite.gz`. */
  name: string;
  /** Primary download URL. */
  url: string;
  /** Additional origins tried, in order, when the primary fails. */
  mirrors?: string[];
  /** MD5 of the file, used for delta skips (native hash, not read into JS). */
  md5?: string | null;
  /** Exact byte size, used for delta skips when no checksum is published. */
  sizeBytes?: number | null;
  /** True when the file is gzipped and must be expanded after download. */
  gzip?: boolean;
}

export type RegionDownloadStatus = 'none' | 'downloading' | 'complete' | 'failed';
