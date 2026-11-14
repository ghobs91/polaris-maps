import NetInfo from '@react-native-community/netinfo';
import { getFreeDiskStorageAsync } from 'expo-file-system/legacy';
import { useMapStore } from '../../stores/mapStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { getPackRegionContainingPoint } from './regionRepository';
import { fetchAndSeedCatalog } from './catalogService';
import { isDownloading, startBackgroundDownload } from './downloadManager';
import { isMeteredConnection } from '../traffic/densityPolicy';
import { logDiagnostic } from '../diagnostics/diagnosticsLog';
import {
  AUTO_DOWNLOAD_SETTLE_MS,
  decideAutoDownload,
  describeDecision,
  type AutoDownloadDecision,
} from './autoRegionDownload';
import type { Region } from '../../models/region';

/**
 * Watches the map viewport and downloads the offline pack for the region the
 * user is looking at.
 *
 * On first open the map is panned to the user's location, so this is what
 * turns "installed the app" into "the area around me renders from local
 * bytes" without the user finding the region list. The decision itself lives
 * in `autoRegionDownload.decideAutoDownload` (pure, unit tested); this module
 * only supplies state and performs the download.
 */

let unsubscribe: (() => void) | null = null;
let settleTimer: ReturnType<typeof setTimeout> | null = null;
/** Region ids already attempted this session (never retried automatically). */
const attempts = new Map<string, number>();
/** Region id we have already started, to avoid duplicate kicks. */
let started: string | null = null;

/** Total pack size, preferring the manifest over the coarse tile size field. */
export function packSizeOf(region: Region): number | null {
  const assets = region.assets ?? [];
  if (assets.length > 0) {
    const sizes = assets.map((a) => a.sizeBytes ?? 0);
    const total = sizes.reduce((sum, n) => sum + n, 0);
    // A manifest without sizes tells us nothing; treat it as unknown.
    return total > 0 ? total : null;
  }
  return region.tilesSizeBytes ?? null;
}

/**
 * Free space, or null when it cannot be read.
 *
 * Null is a real answer, not an error to paper over: `decideAutoDownload` skips
 * with `disk-unknown` rather than guessing, because an auto-download that fills
 * the disk is worse than no download.
 */
async function freeDiskBytes(): Promise<number | null> {
  try {
    return await getFreeDiskStorageAsync();
  } catch {
    return null;
  }
}

async function evaluate(lat: number, lng: number): Promise<AutoDownloadDecision> {
  const settings = useSettingsStore.getState();
  // The candidate, not the already-downloaded region: asking for a `complete`
  // region here can only ever return null for the area the user is looking at,
  // which is precisely the area worth downloading.
  const region = await getPackRegionContainingPoint(lat, lng);
  const [netState, freeBytes] = await Promise.all([NetInfo.fetch(), freeDiskBytes()]);
  const netDetails = netState.details as { isConnectionExpensive?: boolean } | null;

  const decision = decideAutoDownload({
    enabled: settings.autoDownloadRegions,
    regionId: region?.id ?? null,
    packSizeBytes: region ? packSizeOf(region) : null,
    freeBytes,
    downloaded: region?.downloadStatus === 'complete',
    downloading: region ? isDownloading(region.id) : false,
    metered: isMeteredConnection(netState.type, netDetails?.isConnectionExpensive),
    allowMetered: settings.allowMeteredRegionDownloads,
    attempts: region ? (attempts.get(region.id) ?? 0) : 0,
    settled: true, // evaluate() only runs after the settle timer fired
  });

  lastDecision = {
    subject: region ? `${region.name} (${region.id})` : `${lat.toFixed(2)}, ${lng.toFixed(2)}`,
    outcome: decision.start ? `started ${decision.regionId}` : describeDecision(decision),
    at: Date.now(),
  };

  if (decision.start && region) {
    attempts.set(decision.regionId, (attempts.get(decision.regionId) ?? 0) + 1);
    started = decision.regionId;
    logDiagnostic('regions', 'info', describeDecision(decision), {
      regionId: decision.regionId,
      sizeBytes: packSizeOf(region),
    });
    void startBackgroundDownload(region)
      .catch((error) => {
        logDiagnostic('regions', 'warn', 'auto-download failed', {
          regionId: decision.regionId,
          message: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        // Release the latch so panning into a *different* uncovered area later
        // can start the next download. `attempts` still prevents a retry loop
        // on a region that failed this session.
        if (started === decision.regionId) started = null;
      });
  }

  return decision;
}

/** Schedule an evaluation once the viewport stops moving. */
function scheduleEvaluation(lat: number, lng: number): void {
  if (settleTimer) clearTimeout(settleTimer);
  settleTimer = setTimeout(() => {
    settleTimer = null;
    void evaluate(lat, lng).catch(() => {});
  }, AUTO_DOWNLOAD_SETTLE_MS);
}

/**
 * Start watching the viewport (idempotent). Evaluates immediately for the
 * current position so a cold start downloads the user's own region.
 */
export function initAutoRegionDownload(): void {
  if (unsubscribe) return;

  // Seed the catalog before the first evaluation. On a fresh install the region
  // table is empty, so without this there is no candidate to find and nothing
  // is ever downloaded — the user keeps rendering from third-party tiles.
  // Cached manifests seed instantly and offline; a network refresh follows.
  void fetchAndSeedCatalog()
    .catch(() => undefined)
    .finally(() => {
      const { lat, lng } = useMapStore.getState().viewport;
      scheduleEvaluation(lat, lng);
    });

  unsubscribe = useMapStore.subscribe((state) => {
    const { lat: nextLat, lng: nextLng } = state.viewport;
    // Deliberately not gated on `started`: the decision already skips a region
    // that is downloaded, downloading, or already attempted, so the only thing
    // a gate here achieves is never downloading the second area a user pans to.
    scheduleEvaluation(nextLat, nextLng);
  });
}

/** Stop watching (app teardown / tests). */
export function disposeAutoRegionDownload(): void {
  unsubscribe?.();
  unsubscribe = null;
  if (settleTimer) {
    clearTimeout(settleTimer);
    settleTimer = null;
  }
  started = null;
}

export interface AutoDownloadDiagnostics {
  /** Human-readable region name when one was evaluated, else the coordinates. */
  subject: string;
  /** `started` or the skip reason from `describeDecision`. */
  outcome: string;
  at: number;
}

let lastDecision: AutoDownloadDiagnostics | null = null;

/**
 * The most recent auto-download evaluation, for UI display.
 *
 * The decision was previously only written to the diagnostics log, which no
 * screen reads — so "why is my map not downloading" was unanswerable from the
 * device. This is one evaluation deep, not a history; enough to see the
 * current reason (`no-region`, `size-unknown`, `metered`, …).
 */
export function getLastAutoDownloadDecision(): AutoDownloadDiagnostics | null {
  return lastDecision;
}

/** Test-only: reset session state. */
export function __resetAutoRegionDownloadForTests(): void {
  disposeAutoRegionDownload();
  attempts.clear();
  lastDecision = null;
}
