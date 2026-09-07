import { create } from 'zustand';
import type { DownloadProgress } from '../services/regions/downloadService';

interface RegionDownloadState {
  /** Latest progress per region id. Persists while downloads run in background. */
  progressByRegion: Record<string, DownloadProgress>;
  /** Region ids with an active download. */
  activeIds: string[];
  setProgress: (progress: DownloadProgress) => void;
  removeRegion: (regionId: string) => void;
  clearFinished: (regionId: string) => void;
}

export const useRegionDownloadStore = create<RegionDownloadState>()((set) => ({
  progressByRegion: {},
  activeIds: [],
  setProgress: (progress) =>
    set((state) => ({
      progressByRegion: { ...state.progressByRegion, [progress.regionId]: progress },
      activeIds:
        progress.stage === 'complete' || progress.stage === 'error'
          ? state.activeIds.filter((id) => id !== progress.regionId)
          : state.activeIds.includes(progress.regionId)
            ? state.activeIds
            : [...state.activeIds, progress.regionId],
    })),
  removeRegion: (regionId) =>
    set((state) => {
      const next = { ...state.progressByRegion };
      delete next[regionId];
      return { progressByRegion: next, activeIds: state.activeIds.filter((id) => id !== regionId) };
    }),
  clearFinished: (regionId) =>
    set((state) => ({
      activeIds: state.activeIds.filter((id) => id !== regionId),
    })),
}));
