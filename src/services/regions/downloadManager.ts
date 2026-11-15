/**
 * Background-capable region download manager.
 *
 * Problem it solves: `RegionsContent` previously owned AbortControllers in a
 * screen-local ref, so navigating to another tab unmounted the screen and
 * orphaned progress callbacks — and minimizing the app left no owner to
 * resume the download. Downloads now live in this module-level singleton:
 *
 * - One AbortController per region, independent of any React component.
 * - Progress mirrors into `useRegionDownloadStore` so any screen (or a
 *   minimized-then-restored app) can observe it.
 * - `AppState` listener + `resumeInterruptedDownloads()` re-drive any region
 *   left in `downloading` state after a background kill.
 *
 * True OS-level background URLSession work is still bounded by Expo Go /
 * platform limits, but because the download is idempotent (tile fetches skip
 * on retry via file existence in a future pass) and auto-resumes on
 * foreground, a minimized app continues where it left off instead of
 * cancelling.
 */

import { AppState, type AppStateStatus } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { downloadRegion, type DownloadProgress } from './downloadService';
import { getDatabase } from '../database/init';
import { useRegionDownloadStore } from '../../stores/regionDownloadStore';
import type { Region } from '../../models/region';

const controllers = new Map<string, AbortController>();
const running = new Set<string>();
let appStateSub: { remove: () => void } | null = null;

function emit(progress: DownloadProgress): void {
  useRegionDownloadStore.getState().setProgress(progress);
}

export function isDownloading(regionId: string): boolean {
  return running.has(regionId);
}

export function getActiveDownloadIds(): string[] {
  return [...running];
}

/**
 * Start (or attach to) a region download. Safe to call from any screen;
 * navigating away does NOT cancel it. Returns a promise that resolves when
 * the download completes or rejects on failure/cancel.
 */
export async function startBackgroundDownload(region: Region): Promise<void> {
  if (running.has(region.id)) return;
  const controller = new AbortController();
  controllers.set(region.id, controller);
  running.add(region.id);

  const emitForRegion = (progress: DownloadProgress): void =>
    emit({ ...progress, regionName: region.name });

  emitForRegion({
    regionId: region.id,
    totalBytes: 0,
    downloadedBytes: 0,
    percent: 0,
    stage: 'tiles',
  });

  try {
    await downloadRegion(region, emitForRegion, controller.signal);
  } finally {
    controllers.delete(region.id);
    running.delete(region.id);
  }
}

/** Cancel an in-flight download (real abort — wired to downloadService signal). */
/**
 * Cancel a running download, or clear a stale `downloading` row.
 *
 * The stale case is not hypothetical: a region left at `download_status =
 * 'downloading'` by a killed session has no AbortController in this JS runtime,
 * so the old implementation (`controllers.get(id)?.abort()`) was a silent no-op.
 * The card kept showing "Downloading…" with a Cancel button that did nothing,
 * and the row could never be reset. Always clearing the progress store and
 * resetting the row makes Cancel mean what it says.
 */
export function cancelBackgroundDownload(regionId: string): void {
  const controller = controllers.get(regionId);
  if (controller) {
    controller.abort();
    return;
  }

  // No live download: reset the row and drop any partial files so the card
  // returns to "Download" immediately.
  useRegionDownloadStore.getState().removeRegion(regionId);
  void (async () => {
    try {
      const db = await getDatabase();
      await db.runAsync('UPDATE regions SET download_status = ?, last_updated = ? WHERE id = ?', [
        'none',
        Math.floor(Date.now() / 1000),
        regionId,
      ]);
      await FileSystem.deleteAsync(`${FileSystem.documentDirectory}regions/${regionId}/`, {
        idempotent: true,
      }).catch(() => {});
    } catch {
      // Best effort — the next foreground resume reconciles the row.
    }
  })();
}

/**
 * Resume any regions left in `downloading` state (e.g. app was minimized and
 * the OS suspended JS). Call on startup and on foregrounding.
 */
export async function resumeInterruptedDownloads(
  loadRegionById: (id: string) => Promise<Region | null>,
  onDone?: (regionId: string) => void,
): Promise<void> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ id: string }>(
    `SELECT id FROM regions WHERE download_status = 'downloading'`,
  );
  for (const row of rows) {
    if (running.has(row.id)) continue;
    try {
      const region = await loadRegionById(row.id);
      if (!region) continue;
      void startBackgroundDownload(region).then(
        () => onDone?.(row.id),
        () => onDone?.(row.id),
      );
    } catch {
      // Best effort — a failed resume just stays marked downloading.
    }
  }
}

/** Subscribe once to AppState so foregrounding resumes interrupted downloads. */
export function ensureDownloadAppStateHandler(
  loadRegionById: (id: string) => Promise<Region | null>,
  onForeground?: () => void,
): void {
  if (appStateSub) return;
  const handle = (status: AppStateStatus) => {
    if (status === 'active') {
      void resumeInterruptedDownloads(loadRegionById).catch(() => {});
      onForeground?.();
    }
  };
  appStateSub = AppState.addEventListener('change', handle);
}
