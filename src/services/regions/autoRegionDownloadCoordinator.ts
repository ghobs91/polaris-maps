import NetInfo from '@react-native-community/netinfo';
import { useMapStore } from '../../stores/mapStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { getRegionContainingPoint } from './regionRepository';
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

async function evaluate(lat: number, lng: number): Promise<AutoDownloadDecision> {
  const settings = useSettingsStore.getState();
  const region = await getRegionContainingPoint(lat, lng);
  const netState = await NetInfo.fetch();
  const netDetails = netState.details as { isConnectionExpensive?: boolean } | null;

  const decision = decideAutoDownload({
    enabled: settings.autoDownloadRegions,
    regionId: region?.id ?? null,
    packSizeBytes: region ? packSizeOf(region) : null,
    downloaded: region?.downloadStatus === 'complete',
    downloading: region ? isDownloading(region.id) : false,
    metered: isMeteredConnection(netState.type, netDetails?.isConnectionExpensive),
    allowMetered: settings.allowMeteredRegionDownloads,
    attempts: region ? (attempts.get(region.id) ?? 0) : 0,
    settled: true, // evaluate() only runs after the settle timer fired
  });

  if (decision.start && region) {
    attempts.set(decision.regionId, (attempts.get(decision.regionId) ?? 0) + 1);
    started = decision.regionId;
    logDiagnostic('regions', 'info', describeDecision(decision), {
      regionId: decision.regionId,
      sizeBytes: packSizeOf(region),
    });
    void startBackgroundDownload(region).catch((error) => {
      logDiagnostic('regions', 'warn', 'auto-download failed', {
        regionId: decision.regionId,
        message: error instanceof Error ? error.message : String(error),
      });
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

  const { lat, lng } = useMapStore.getState().viewport;
  scheduleEvaluation(lat, lng);

  unsubscribe = useMapStore.subscribe((state) => {
    const { lat: nextLat, lng: nextLng } = state.viewport;
    // Only reschedule when the view actually moved somewhere new.
    if (started) return;
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

/** Test-only: reset session state. */
export function __resetAutoRegionDownloadForTests(): void {
  disposeAutoRegionDownload();
  attempts.clear();
}
