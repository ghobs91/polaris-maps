import { create } from 'zustand';
import type { AggregatedTrafficState, TrafficProbe } from '../models/traffic';

interface TrafficState {
  segmentTraffic: Record<string, AggregatedTrafficState>;
  activeSubscriptionCount: number;
  isCollectingProbes: boolean;
  wakuPeerCount: number;

  updateSegment: (state: AggregatedTrafficState) => void;
  removeSegment: (segmentId: string) => void;
  setSubscriptionCount: (count: number) => void;
  setCollecting: (collecting: boolean) => void;
  setWakuPeerCount: (count: number) => void;
  clearAll: () => void;
}

export const useTrafficStore = create<TrafficState>()((set) => ({
  segmentTraffic: {},
  activeSubscriptionCount: 0,
  isCollectingProbes: false,
  wakuPeerCount: 0,

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
  clearAll: () => set({ segmentTraffic: {}, activeSubscriptionCount: 0 }),
}));
