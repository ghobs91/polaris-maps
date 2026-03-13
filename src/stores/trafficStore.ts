import { create } from 'zustand';
import type { AggregatedTrafficState, NormalizedTrafficSegment } from '../models/traffic';

interface TrafficState {
  segmentTraffic: Record<string, AggregatedTrafficState>;
  activeSubscriptionCount: number;
  isCollectingProbes: boolean;
  wakuPeerCount: number;

  // External traffic API state
  normalizedSegments: NormalizedTrafficSegment[];
  isExternalFetchLoading: boolean;
  lastExternalFetchAt: number | null;

  updateSegment: (state: AggregatedTrafficState) => void;
  removeSegment: (segmentId: string) => void;
  setSubscriptionCount: (count: number) => void;
  setCollecting: (collecting: boolean) => void;
  setWakuPeerCount: (count: number) => void;
  setNormalizedSegments: (segments: NormalizedTrafficSegment[]) => void;
  setExternalFetchLoading: (loading: boolean) => void;
  clearAll: () => void;
}

export const useTrafficStore = create<TrafficState>()((set) => ({
  segmentTraffic: {},
  activeSubscriptionCount: 0,
  isCollectingProbes: false,
  wakuPeerCount: 0,

  normalizedSegments: [],
  isExternalFetchLoading: false,
  lastExternalFetchAt: null,

  updateSegment: (state) =>
    set((prev) => ({
      segmentTraffic: { ...prev.segmentTraffic, [state.segmentId]: state },
    })),
  removeSegment: (segmentId) =>
    set((prev) => {
      const { [segmentId]: _, ...rest } = prev.segmentTraffic;
      return { segmentTraffic: rest };
    }),
  setSubscriptionCount: (activeSubscriptionCount) => set({ activeSubscriptionCount }),
  setCollecting: (isCollectingProbes) => set({ isCollectingProbes }),
  setWakuPeerCount: (wakuPeerCount) => set({ wakuPeerCount }),
  setNormalizedSegments: (normalizedSegments) =>
    set({ normalizedSegments, lastExternalFetchAt: Math.floor(Date.now() / 1000) }),
  setExternalFetchLoading: (isExternalFetchLoading) => set({ isExternalFetchLoading }),
  clearAll: () =>
    set({
      segmentTraffic: {},
      activeSubscriptionCount: 0,
      normalizedSegments: [],
      isExternalFetchLoading: false,
      lastExternalFetchAt: null,
    }),
}));
