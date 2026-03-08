/**
 * App-wide configuration constants.
 *
 * DATA_BASE_URL is the HTTP base URL where pre-built region data is hosted.
 * During development, generate data with `scripts/generate-region-data.sh`
 * and serve it locally:
 *   cd region-data && python3 -m http.server 9000
 *
 * The app downloads region assets from:
 *   {DATA_BASE_URL}/{region-id}/tiles.pmtiles
 *   {DATA_BASE_URL}/{region-id}/routing.tar
 *   {DATA_BASE_URL}/{region-id}/geocoding.db
 *
 * When Arweave tx IDs are available, the app uses Arweave gateways instead.
 * Set to null to disable direct HTTP downloads and only use Arweave/GitHub.
 */
export const DATA_BASE_URL: string | null = null;

/**
 * GitHub repository that publishes pre-built region map data via Releases.
 * Format: "owner/repo"
 *
 * The CI workflow (.github/workflows/build-region-data.yml) automatically
 * builds tiles from OpenStreetMap data (Geofabrik) and uploads them to
 * GitHub Releases as assets named: {regionId}-tiles.pmtiles, {regionId}-routing.tar,
 * {regionId}-geocoding.db. The app queries the GitHub API to find the latest
 * release tag and downloads from there.
 *
 * Set to null to disable GitHub Releases as a source.
 */
export const GITHUB_DATA_REPO: 'ghobs91/polaris-maps' | null = null;

/**
 * Arweave gateway base URL for permanent decentralized storage.
 * Used when regions have published Arweave transaction IDs.
 */
export const ARWEAVE_GATEWAY = 'https://arweave.net';
