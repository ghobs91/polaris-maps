jest.mock('react-native', () => ({
  AppState: {
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
  Platform: { OS: 'ios' },
  NativeModules: {},
}));

jest.mock('../../src/native/liveActivity', () => ({
  isAvailable: true,
  startDownloadActivity: jest.fn(),
  updateDownloadActivity: jest.fn(),
  endDownloadActivity: jest.fn(),
}));

import { AppState, type AppStateStatus } from 'react-native';
import * as LiveActivity from '../../src/native/liveActivity';
import { useRegionDownloadStore } from '../../src/stores/regionDownloadStore';
import type { DownloadProgress } from '../../src/services/regions/downloadService';
import {
  computeDownloadAggregate,
  createDownloadLiveActivityController,
  initDownloadLiveActivity,
  DOWNLOAD_LIVE_ACTIVITY_THROTTLE_MS,
  type DownloadLiveActivitySnapshot,
} from '../../src/services/regions/downloadLiveActivity';

function makeProgress(overrides: Partial<DownloadProgress> = {}): DownloadProgress {
  return {
    regionId: 'r1',
    regionName: 'Boston',
    totalBytes: 0,
    downloadedBytes: 0,
    percent: 0,
    stage: 'tiles',
    ...overrides,
  };
}

describe('computeDownloadAggregate', () => {
  it('returns null when nothing is actively downloading', () => {
    expect(computeDownloadAggregate({}, [])).toBeNull();
  });

  it('aggregates a single region with its name and percentage', () => {
    const result = computeDownloadAggregate({ r1: makeProgress({ percent: 42, stage: 'tiles' }) }, [
      'r1',
    ]);
    expect(result).toEqual({
      percent: 42,
      regionCount: 1,
      label: 'Boston',
      stage: 'Downloading map tiles',
      isComplete: false,
    });
  });

  it('falls back to a generic label when a single region has no name', () => {
    const result = computeDownloadAggregate({ r1: makeProgress({ regionName: undefined }) }, [
      'r1',
    ]);
    expect(result?.label).toBe('1 region');
  });

  it('averages percentage equally across multiple active regions', () => {
    const result = computeDownloadAggregate(
      {
        r1: makeProgress({ regionId: 'r1', percent: 10, stage: 'tiles' }),
        r2: makeProgress({
          regionId: 'r2',
          regionName: 'Cambridge',
          percent: 50,
          stage: 'geocoding',
        }),
      },
      ['r1', 'r2'],
    );
    expect(result?.percent).toBe(30);
    expect(result?.regionCount).toBe(2);
    expect(result?.label).toBe('2 regions');
    expect(result?.stage).toBe('Downloading search index');
  });

  it('excludes regions in terminal stages', () => {
    const result = computeDownloadAggregate(
      {
        r1: makeProgress({ regionId: 'r1', percent: 100, stage: 'complete' }),
        r2: makeProgress({ regionId: 'r2', percent: 20, stage: 'tiles' }),
      },
      ['r1', 'r2'],
    );
    expect(result?.regionCount).toBe(1);
    expect(result?.percent).toBe(20);
  });

  it('clamps the aggregate percentage to 0-100', () => {
    const high = computeDownloadAggregate({ r1: makeProgress({ percent: 150 }) }, ['r1']);
    const low = computeDownloadAggregate({ r1: makeProgress({ percent: -20 }) }, ['r1']);
    expect(high?.percent).toBe(100);
    expect(low?.percent).toBe(0);
  });
});

describe('createDownloadLiveActivityController', () => {
  let now: number;

  function setup(snapshot: DownloadLiveActivitySnapshot) {
    const native = { start: jest.fn(), update: jest.fn(), end: jest.fn() };
    const controller = createDownloadLiveActivityController({
      getSnapshot: () => snapshot,
      native,
      now: () => now,
    });
    return { controller, native };
  }

  beforeEach(() => {
    now = 0;
  });

  it('starts the activity when backgrounding with an active download', () => {
    const snapshot: DownloadLiveActivitySnapshot = {
      progressByRegion: { r1: makeProgress({ percent: 5 }) },
      activeIds: ['r1'],
    };
    const { controller, native } = setup(snapshot);

    controller.onAppStateChange('inactive');

    expect(native.start).toHaveBeenCalledTimes(1);
    expect(native.start).toHaveBeenCalledWith(
      expect.objectContaining({ percent: 5, regionCount: 1, label: 'Boston' }),
    );
    expect(controller.isActive()).toBe(true);
  });

  it('does not start when backgrounding with no active download', () => {
    const { controller, native } = setup({ progressByRegion: {}, activeIds: [] });
    controller.onAppStateChange('background');
    expect(native.start).not.toHaveBeenCalled();
    expect(controller.isActive()).toBe(false);
  });

  it('does not start twice across inactive then background', () => {
    const snapshot: DownloadLiveActivitySnapshot = {
      progressByRegion: { r1: makeProgress() },
      activeIds: ['r1'],
    };
    const { controller, native } = setup(snapshot);

    controller.onAppStateChange('inactive');
    controller.onAppStateChange('background');

    expect(native.start).toHaveBeenCalledTimes(1);
  });

  it('ends immediately and deactivates when returning to the foreground', () => {
    const snapshot: DownloadLiveActivitySnapshot = {
      progressByRegion: { r1: makeProgress() },
      activeIds: ['r1'],
    };
    const { controller, native } = setup(snapshot);

    controller.onAppStateChange('inactive');
    controller.onAppStateChange('active');

    expect(native.end).toHaveBeenCalledWith(true);
    expect(controller.isActive()).toBe(false);
  });

  it('throttles progress updates and skips unchanged aggregates', () => {
    const snapshot: DownloadLiveActivitySnapshot = {
      progressByRegion: { r1: makeProgress({ percent: 5 }) },
      activeIds: ['r1'],
    };
    const { controller, native } = setup(snapshot);
    controller.onAppStateChange('inactive');

    // Changed, but within the throttle window.
    now = DOWNLOAD_LIVE_ACTIVITY_THROTTLE_MS - 1;
    snapshot.progressByRegion.r1 = makeProgress({ percent: 12 });
    controller.onSnapshotChange();
    expect(native.update).not.toHaveBeenCalled();

    // After the window, the changed aggregate is pushed.
    now = DOWNLOAD_LIVE_ACTIVITY_THROTTLE_MS;
    controller.onSnapshotChange();
    expect(native.update).toHaveBeenCalledTimes(1);
    expect(native.update).toHaveBeenLastCalledWith(expect.objectContaining({ percent: 12 }));

    // Same values after the window are still skipped.
    now = DOWNLOAD_LIVE_ACTIVITY_THROTTLE_MS * 3;
    controller.onSnapshotChange();
    expect(native.update).toHaveBeenCalledTimes(1);
  });

  it('ignores progress changes while foregrounded', () => {
    const snapshot: DownloadLiveActivitySnapshot = {
      progressByRegion: { r1: makeProgress({ percent: 5 }) },
      activeIds: ['r1'],
    };
    const { controller, native } = setup(snapshot);

    now = DOWNLOAD_LIVE_ACTIVITY_THROTTLE_MS * 2;
    controller.onSnapshotChange();
    expect(native.start).not.toHaveBeenCalled();
    expect(native.update).not.toHaveBeenCalled();
  });

  it('marks complete and ends with a delayed dismissal when all downloads finish', () => {
    const snapshot: DownloadLiveActivitySnapshot = {
      progressByRegion: { r1: makeProgress({ percent: 50 }) },
      activeIds: ['r1'],
    };
    const { controller, native } = setup(snapshot);
    controller.onAppStateChange('inactive');

    snapshot.activeIds = [];
    controller.onSnapshotChange();

    expect(native.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ percent: 100, isComplete: true, label: 'Boston' }),
    );
    expect(native.end).toHaveBeenCalledWith(false);
    expect(controller.isActive()).toBe(false);
  });
});

describe('initDownloadLiveActivity', () => {
  it('wires AppState and download progress to the native activity', () => {
    (AppState.addEventListener as jest.Mock).mockClear();
    (LiveActivity.startDownloadActivity as jest.Mock).mockClear();
    (LiveActivity.endDownloadActivity as jest.Mock).mockClear();
    useRegionDownloadStore.setState({ progressByRegion: {}, activeIds: [] });

    initDownloadLiveActivity();

    const calls = (AppState.addEventListener as jest.Mock).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const handler = calls[calls.length - 1][1] as (state: AppStateStatus) => void;

    useRegionDownloadStore.getState().setProgress(makeProgress({ percent: 10 }));
    handler('background');

    expect(LiveActivity.startDownloadActivity).toHaveBeenCalledTimes(1);
    expect(LiveActivity.startDownloadActivity).toHaveBeenCalledWith(
      expect.objectContaining({ percent: 10, label: 'Boston' }),
    );

    handler('active');
    expect(LiveActivity.endDownloadActivity).toHaveBeenCalledWith(true);
  });
});
