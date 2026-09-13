/**
 * Background-only Live Activity for offline region downloads.
 *
 * Live Activities cannot be started from the background on iOS, so this
 * controller starts one as the app resigns active (`inactive`, with
 * `background` as a retry) while at least one download is running, mirrors
 * aggregate progress into it, and ends it when the app returns to `active`.
 *
 * Downloads themselves are owned by `downloadManager` / `regionDownloadStore`
 * and are unaffected by this module — every native call is a no-op when Live
 * Activities are unavailable.
 */

import { AppState, type AppStateStatus } from 'react-native';
import type { DownloadLiveActivityState } from '../../native/liveActivity';
import {
  startDownloadActivity,
  updateDownloadActivity,
  endDownloadActivity,
  isAvailable,
} from '../../native/liveActivity';
import { useRegionDownloadStore } from '../../stores/regionDownloadStore';
import type { DownloadProgress } from './downloadService';

/** Minimum gap between native updates while backgrounded. */
export const DOWNLOAD_LIVE_ACTIVITY_THROTTLE_MS = 1000;

export type DownloadAggregate = DownloadLiveActivityState;

export interface DownloadLiveActivitySnapshot {
  progressByRegion: Record<string, DownloadProgress>;
  activeIds: string[];
}

export interface DownloadLiveActivityNative {
  start(state: DownloadAggregate): void;
  update(state: DownloadAggregate): void;
  end(immediate: boolean): void;
}

export interface DownloadLiveActivityControllerDeps {
  getSnapshot: () => DownloadLiveActivitySnapshot;
  native: DownloadLiveActivityNative;
  now?: () => number;
}

export interface DownloadLiveActivityController {
  onAppStateChange(state: AppStateStatus): void;
  onSnapshotChange(): void;
  isActive(): boolean;
}

const STAGE_LABELS: Record<DownloadProgress['stage'], string> = {
  tiles: 'Downloading map tiles',
  places: 'Importing places',
  routing: 'Downloading routing data',
  geocoding: 'Downloading search index',
  complete: 'Download complete',
  error: 'Download failed',
};

function isTerminal(stage: DownloadProgress['stage']): boolean {
  return stage === 'complete' || stage === 'error';
}

/**
 * Collapse per-region progress into a single aggregate for the Live Activity.
 * Returns `null` when nothing is actively downloading. Regions in a terminal
 * stage are excluded; the percentage is an equal-weight mean across the rest.
 */
export function computeDownloadAggregate(
  progressByRegion: Record<string, DownloadProgress>,
  activeIds: string[],
): DownloadAggregate | null {
  const active = activeIds
    .map((id) => progressByRegion[id])
    .filter(
      (progress): progress is DownloadProgress => progress != null && !isTerminal(progress.stage),
    );

  if (active.length === 0) return null;

  const percent = Math.round(
    active.reduce((sum, progress) => sum + progress.percent, 0) / active.length,
  );
  const label =
    active.length === 1 ? (active[0].regionName ?? '1 region') : `${active.length} regions`;
  const stage = STAGE_LABELS[active[active.length - 1].stage] ?? 'Preparing…';

  return {
    percent: Math.max(0, Math.min(100, percent)),
    regionCount: active.length,
    label,
    stage,
    isComplete: false,
  };
}

function signature(state: DownloadAggregate): string {
  return `${state.percent}|${state.regionCount}|${state.label}|${state.stage}`;
}

export function createDownloadLiveActivityController(
  deps: DownloadLiveActivityControllerDeps,
): DownloadLiveActivityController {
  const now = deps.now ?? Date.now;
  let active = false;
  let lastSentAt = 0;
  let lastSignature = '';
  let lastAggregate: DownloadAggregate | null = null;

  const reset = (): void => {
    active = false;
    lastSentAt = 0;
    lastSignature = '';
    lastAggregate = null;
  };

  const push = (aggregate: DownloadAggregate, force: boolean): void => {
    const timestamp = now();
    const sig = signature(aggregate);
    if (!force) {
      if (sig === lastSignature) return;
      if (timestamp - lastSentAt < DOWNLOAD_LIVE_ACTIVITY_THROTTLE_MS) return;
    }
    lastSentAt = timestamp;
    lastSignature = sig;
    lastAggregate = aggregate;
    if (active) {
      deps.native.update(aggregate);
    } else {
      active = true;
      deps.native.start(aggregate);
    }
  };

  const onAppStateChange = (state: AppStateStatus): void => {
    if (state === 'active') {
      if (active) {
        reset();
        deps.native.end(true);
      }
      return;
    }
    if (state === 'inactive' || state === 'background') {
      const snapshot = deps.getSnapshot();
      const aggregate = computeDownloadAggregate(snapshot.progressByRegion, snapshot.activeIds);
      if (!aggregate) return;
      push(aggregate, !active);
    }
  };

  const onSnapshotChange = (): void => {
    if (!active) return;
    const snapshot = deps.getSnapshot();
    const aggregate = computeDownloadAggregate(snapshot.progressByRegion, snapshot.activeIds);
    if (aggregate) {
      push(aggregate, false);
      return;
    }
    // All downloads finished, errored, or were cancelled while backgrounded.
    deps.native.update({
      percent: 100,
      regionCount: lastAggregate?.regionCount ?? 0,
      label: lastAggregate?.label ?? 'Offline maps',
      stage: 'Download complete',
      isComplete: true,
    });
    reset();
    deps.native.end(false);
  };

  return {
    onAppStateChange,
    onSnapshotChange,
    isActive: () => active,
  };
}

let initialized = false;

/**
 * Wire the download Live Activity to app lifecycle and download progress.
 * Idempotent and safe to call from the root layout on every launch. Does
 * nothing on platforms without the native module.
 */
export function initDownloadLiveActivity(): void {
  if (initialized || !isAvailable) return;
  initialized = true;

  const controller = createDownloadLiveActivityController({
    getSnapshot: () => {
      const state = useRegionDownloadStore.getState();
      return { progressByRegion: state.progressByRegion, activeIds: state.activeIds };
    },
    native: {
      start: (state) => startDownloadActivity(state),
      update: (state) => updateDownloadActivity(state),
      end: (immediate) => endDownloadActivity(immediate),
    },
  });

  AppState.addEventListener('change', controller.onAppStateChange);
  useRegionDownloadStore.subscribe(controller.onSnapshotChange);
}
