import * as FileSystem from 'expo-file-system';
import { getDatabase } from '../database/init';
import { updatePeerMetrics } from '../sync/peerService';
import { isStorageAvailable } from '../sync/resourceManager';
import type { Region } from '../../models/region';

const ARWEAVE_GATEWAY = 'https://arweave.net';

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
  await db.runAsync('UPDATE regions SET download_status = ?, updated_at = ? WHERE id = ?', [
    'downloading',
    Math.floor(Date.now() / 1000),
    region.id,
  ]);

  try {
    // Stage 1: Download PMTiles
    onProgress?.({
      regionId: region.id,
      totalBytes: 0,
      downloadedBytes: 0,
      percent: 0,
      stage: 'tiles',
    });

    if (region.pmtilesTxId) {
      await downloadFile(
        `${ARWEAVE_GATEWAY}/${region.pmtilesTxId}`,
        `${destDir}tiles.pmtiles`,
        region.id,
        (downloaded, total) => {
          onProgress?.({
            regionId: region.id,
            totalBytes: total,
            downloadedBytes: downloaded,
            percent: total > 0 ? (downloaded / total) * 33 : 0,
            stage: 'tiles',
          });
        },
      );
    }

    // Stage 2: Download Valhalla routing graph
    onProgress?.({
      regionId: region.id,
      totalBytes: 0,
      downloadedBytes: 0,
      percent: 33,
      stage: 'routing',
    });

    if (region.routingGraphTxId) {
      await downloadFile(
        `${ARWEAVE_GATEWAY}/${region.routingGraphTxId}`,
        `${destDir}routing.tar`,
        region.id,
        (downloaded, total) => {
          onProgress?.({
            regionId: region.id,
            totalBytes: total,
            downloadedBytes: downloaded,
            percent: 33 + (total > 0 ? (downloaded / total) * 33 : 0),
            stage: 'routing',
          });
        },
      );
    }

    // Stage 3: Download geocoding database
    onProgress?.({
      regionId: region.id,
      totalBytes: 0,
      downloadedBytes: 0,
      percent: 66,
      stage: 'geocoding',
    });

    if (region.geocodingDbTxId) {
      await downloadFile(
        `${ARWEAVE_GATEWAY}/${region.geocodingDbTxId}`,
        `${destDir}geocoding.db`,
        region.id,
        (downloaded, total) => {
          onProgress?.({
            regionId: region.id,
            totalBytes: total,
            downloadedBytes: downloaded,
            percent: 66 + (total > 0 ? (downloaded / total) * 34 : 0),
            stage: 'geocoding',
          });
        },
      );
    }

    // Calculate total size
    const dirInfo = await FileSystem.getInfoAsync(destDir);
    const totalSize = (dirInfo as { size?: number }).size ?? 0;

    // Mark as downloaded
    await db.runAsync(
      'UPDATE regions SET download_status = ?, size_bytes = ?, updated_at = ? WHERE id = ?',
      ['complete', totalSize, Math.floor(Date.now() / 1000), region.id],
    );

    await updatePeerMetrics({ cacheSizeBytes: totalSize });

    onProgress?.({
      regionId: region.id,
      totalBytes: totalSize,
      downloadedBytes: totalSize,
      percent: 100,
      stage: 'complete',
    });
  } catch (error) {
    await db.runAsync('UPDATE regions SET download_status = ?, updated_at = ? WHERE id = ?', [
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

export function cancelDownload(regionId: string): void {
  const resumable = activeDownloads.get(regionId);
  if (resumable) {
    resumable.pauseAsync();
    activeDownloads.delete(regionId);
  }
}

export async function deleteRegionData(regionId: string): Promise<void> {
  const destDir = `${FileSystem.documentDirectory}regions/${regionId}/`;
  const info = await FileSystem.getInfoAsync(destDir);
  if (info.exists) {
    await FileSystem.deleteAsync(destDir, { idempotent: true });
  }

  const db = await getDatabase();
  await db.runAsync(
    'UPDATE regions SET download_status = ?, size_bytes = 0, updated_at = ? WHERE id = ?',
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
