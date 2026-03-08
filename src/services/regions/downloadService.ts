import * as FileSystem from 'expo-file-system';
import { getDatabase } from '../database/init';
import { updatePeerMetrics } from '../sync/peerService';
import { isStorageAvailable } from '../sync/resourceManager';
import { extractTar } from '../../utils/archiveExtract';
import { downloadFromPeers, seedRegion, unseedRegion } from '../sync/hyperdriveBridge';
import { DATA_BASE_URL, ARWEAVE_GATEWAY, GITHUB_DATA_REPO } from '../../constants/config';
import type { Region } from '../../models/region';

/** Cached latest GitHub release tag to avoid repeated API calls. */
let cachedGitHubTag: string | null | undefined = undefined;

/** Fetch the latest GitHub release tag for the data repo, or null if unavailable. */
async function getLatestGitHubTag(): Promise<string | null> {
  if (cachedGitHubTag !== undefined) return cachedGitHubTag;
  if (!GITHUB_DATA_REPO) return (cachedGitHubTag = null);
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_DATA_REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return (cachedGitHubTag = null);
    const json = (await res.json()) as { tag_name: string };
    return (cachedGitHubTag = json.tag_name);
  } catch {
    return (cachedGitHubTag = null);
  }
}

/** Resolve the download URL for a region asset. Priority: Arweave > GitHub Releases > DATA_BASE_URL. */
async function resolveUrl(
  regionId: string,
  filename: string,
  arweaveTxId: string | null,
): Promise<string | null> {
  if (arweaveTxId) return `${ARWEAVE_GATEWAY}/${arweaveTxId}`;
  const tag = await getLatestGitHubTag();
  if (tag) {
    const asset = `${regionId}-${filename}`;
    return `https://github.com/${GITHUB_DATA_REPO}/releases/download/${tag}/${asset}`;
  }
  if (DATA_BASE_URL) return `${DATA_BASE_URL}/${regionId}/${filename}`;
  return null;
}

export interface DownloadProgress {
  regionId: string;
  totalBytes: number;
  downloadedBytes: number;
  percent: number;
  stage: 'tiles' | 'routing' | 'geocoding' | 'complete' | 'error';
  error?: string;
}

type ProgressCallback = (progress: DownloadProgress) => void;

const activeDownloads = new Map<string, FileSystem.DownloadResumable>();

export async function downloadRegion(region: Region, onProgress?: ProgressCallback): Promise<void> {
  const destDir = `${FileSystem.documentDirectory}regions/${region.id}/`;
  await FileSystem.makeDirectoryAsync(destDir, { intermediates: true });

  const db = await getDatabase();

  // Update region status to downloading
  await db.runAsync('UPDATE regions SET download_status = ?, last_updated = ? WHERE id = ?', [
    'downloading',
    Math.floor(Date.now() / 1000),
    region.id,
  ]);

  try {
    // Try P2P download first if a drive key is known
    const peerSuccess = region.driveKey
      ? await tryPeerDownload(region, destDir, onProgress)
      : false;

    if (!peerSuccess) {
      await downloadViaHttp(region, destDir, onProgress);
    }

    // Calculate total size
    const dirInfo = await FileSystem.getInfoAsync(destDir);
    const totalSize = (dirInfo as { size?: number }).size ?? 0;

    // Mark as downloaded
    await db.runAsync(
      'UPDATE regions SET download_status = ?, downloaded_at = ?, last_updated = ? WHERE id = ?',
      ['complete', Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000), region.id],
    );

    await updatePeerMetrics({ cacheSizeBytes: totalSize });

    onProgress?.({
      regionId: region.id,
      totalBytes: totalSize,
      downloadedBytes: totalSize,
      percent: 100,
      stage: 'complete',
    });

    // Auto-seed the downloaded region so other peers can fetch from us
    autoSeedRegion(region.id, destDir, db).catch(() => {
      // Non-fatal — seeding failure shouldn't affect the download result
    });
  } catch (error) {
    await db.runAsync('UPDATE regions SET download_status = ?, last_updated = ? WHERE id = ?', [
      'failed',
      Math.floor(Date.now() / 1000),
      region.id,
    ]);

    onProgress?.({
      regionId: region.id,
      totalBytes: 0,
      downloadedBytes: 0,
      percent: 0,
      stage: 'error',
      error: (error as Error).message,
    });

    throw error;
  } finally {
    activeDownloads.delete(region.id);
  }
}

/** Attempt to download region data from P2P peers. Returns true if successful. */
async function tryPeerDownload(
  region: Region,
  destDir: string,
  onProgress?: ProgressCallback,
): Promise<boolean> {
  if (!region.driveKey) return false;
  try {
    onProgress?.({
      regionId: region.id,
      totalBytes: 0,
      downloadedBytes: 0,
      percent: 0,
      stage: 'tiles',
    });

    await downloadFromPeers(region.driveKey, destDir, (_file, _bytes, totalBytes) => {
      onProgress?.({
        regionId: region.id,
        totalBytes,
        downloadedBytes: totalBytes,
        percent: Math.min(99, totalBytes > 0 ? 50 : 0),
        stage: 'tiles',
      });
    });

    // Hyperdrive download puts files directly — check routing needs extraction
    const routingTar = `${destDir}routing.tar`;
    const tarInfo = await FileSystem.getInfoAsync(routingTar);
    if (tarInfo.exists) {
      await extractTar(routingTar, `${destDir}routing/`);
      await FileSystem.deleteAsync(routingTar, { idempotent: true });
    }

    return true;
  } catch {
    // P2P failed — fall through to HTTP
    return false;
  }
}

/** Download region data via HTTP (Arweave > GitHub Releases > DATA_BASE_URL). */
async function downloadViaHttp(
  region: Region,
  destDir: string,
  onProgress?: ProgressCallback,
): Promise<void> {
  const tilesUrl = await resolveUrl(region.id, 'tiles.pmtiles', region.pmtilesTxId);
  const routingUrl = await resolveUrl(region.id, 'routing.tar', region.routingGraphTxId);
  const geocodingUrl = await resolveUrl(region.id, 'geocoding.db', region.geocodingDbTxId);

  if (!routingUrl) {
    throw new Error(
      'Routing data is not available for this region. Generate region data with scripts/generate-region-data.sh and serve it, or publish to Arweave.',
    );
  }

  // Stage 1: Download PMTiles
  onProgress?.({
    regionId: region.id,
    totalBytes: 0,
    downloadedBytes: 0,
    percent: 0,
    stage: 'tiles',
  });

  if (tilesUrl) {
    await downloadFile(tilesUrl, `${destDir}tiles.pmtiles`, region.id, (downloaded, total) => {
      onProgress?.({
        regionId: region.id,
        totalBytes: total,
        downloadedBytes: downloaded,
        percent: total > 0 ? (downloaded / total) * 33 : 0,
        stage: 'tiles',
      });
    });
  }

  // Stage 2: Download Valhalla routing graph
  onProgress?.({
    regionId: region.id,
    totalBytes: 0,
    downloadedBytes: 0,
    percent: 33,
    stage: 'routing',
  });

  await downloadFile(routingUrl, `${destDir}routing.tar`, region.id, (downloaded, total) => {
    onProgress?.({
      regionId: region.id,
      totalBytes: total,
      downloadedBytes: downloaded,
      percent: 33 + (total > 0 ? (downloaded / total) * 33 : 0),
      stage: 'routing',
    });
  });

  // Extract the Valhalla graph tiles from the tar archive
  await extractTar(`${destDir}routing.tar`, `${destDir}routing/`);
  await FileSystem.deleteAsync(`${destDir}routing.tar`, { idempotent: true });

  // Stage 3: Download geocoding database
  onProgress?.({
    regionId: region.id,
    totalBytes: 0,
    downloadedBytes: 0,
    percent: 66,
    stage: 'geocoding',
  });

  if (geocodingUrl) {
    await downloadFile(geocodingUrl, `${destDir}geocoding.db`, region.id, (downloaded, total) => {
      onProgress?.({
        regionId: region.id,
        totalBytes: total,
        downloadedBytes: downloaded,
        percent: 66 + (total > 0 ? (downloaded / total) * 34 : 0),
        stage: 'geocoding',
      });
    });
  }
}

/** Seed a downloaded region in the background and persist the drive key. */
async function autoSeedRegion(
  regionId: string,
  filesDir: string,
  db: Awaited<ReturnType<typeof getDatabase>>,
): Promise<void> {
  const { key } = await seedRegion(regionId, filesDir);
  await db.runAsync('UPDATE regions SET drive_key = ? WHERE id = ?', [key, regionId]);
}

export function cancelDownload(regionId: string): void {
  const resumable = activeDownloads.get(regionId);
  if (resumable) {
    resumable.pauseAsync();
    activeDownloads.delete(regionId);
  }
}

export async function deleteRegionData(regionId: string): Promise<void> {
  // Stop seeding this region via Hyperdrive
  unseedRegion(regionId).catch(() => {});

  const destDir = `${FileSystem.documentDirectory}regions/${regionId}/`;
  const info = await FileSystem.getInfoAsync(destDir);
  if (info.exists) {
    await FileSystem.deleteAsync(destDir, { idempotent: true });
  }

  const db = await getDatabase();
  await db.runAsync(
    'UPDATE regions SET download_status = ?, downloaded_at = NULL, drive_key = NULL, last_updated = ? WHERE id = ?',
    ['none', Math.floor(Date.now() / 1000), regionId],
  );
}

async function downloadFile(
  url: string,
  dest: string,
  regionId: string,
  onProgress: (downloaded: number, total: number) => void,
): Promise<void> {
  const callback: FileSystem.DownloadProgressCallback = (data) => {
    onProgress(data.totalBytesWritten, data.totalBytesExpectedToWrite);
  };

  const resumable = FileSystem.createDownloadResumable(url, dest, {}, callback);
  activeDownloads.set(regionId, resumable);

  const result = await resumable.downloadAsync();
  if (!result) throw new Error(`Download failed for ${url}`);
}
