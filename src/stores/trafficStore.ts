import { create } from 'zustand';
import type {
  AggregatedTrafficState,
  NormalizedTrafficSegment,
  TrafficMode,
} from '../models/traffic';

interface TrafficState {
  segmentTraffic: Record<string, AggregatedTrafficState>;
  activeSubscriptionCount: number;
  isCollectingProbes: boolean;

  /** Number of directly connected Hyperswarm peers for current geohash topics. */
  swarmPeerCount: number;
  /** Number of connected Nostr relays (fallback layer). */
  nostrRelayCount: number;
  /** Current traffic exchange mode (auto-selected based on swarm peer density). */
  trafficMode: TrafficMode;

  // External traffic API state
  normalizedSegments: NormalizedTrafficSegment[];
  isExternalFetchLoading: boolean;
  lastExternalFetchAt: number | null;

  updateSegment: (state: AggregatedTrafficState) => void;
  removeSegment: (segmentId: string) => void;
  bulkUpdateSegments: (states: AggregatedTrafficState[]) => void;
  setSubscriptionCount: (count: number) => void;
  setCollecting: (collecting: boolean) => void;
  setSwarmPeerCount: (count: number) => void;
  setNostrRelayCount: (count: number) => void;
  setTrafficMode: (mode: TrafficMode) => void;
  setNormalizedSegments: (segments: NormalizedTrafficSegment[]) => void;
  setExternalFetchLoading: (loading: boolean) => void;
  clearAll: () => void;
}

export const useTrafficStore = create<TrafficState>()((set) => ({
  segmentTraffic: {},
  activeSubscriptionCount: 0,
  isCollectingProbes: false,
  swarmPeerCount: 0,
  nostrRelayCount: 0,
  trafficMode: 'hyperswarm',

  normalizedSegments: [],
  isExternalFetchLoading: false,
  lastExternalFetchAt: null,

  updateSegment: (state) =>
    set((prev) => ({
      segmentTraffic: { ...prev.segmentTraffic, [state.segmentId]: state },
    })),
  removeSegment: (segmentId) =>
    set((prev) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [segmentId]: _, ...rest } = prev.segmentTraffic;
      return { segmentTraffic: rest };
    }),
  bulkUpdateSegments: (states) =>
    set((prev) => {
      const updated = { ...prev.segmentTraffic };
      for (const s of states) {
        updated[s.segmentId] = s;
      }
      return { segmentTraffic: updated };
    }),
  setSubscriptionCount: (activeSubscriptionCount) => set({ activeSubscriptionCount }),
  setCollecting: (isCollectingProbes) => set({ isCollectingProbes }),
  setSwarmPeerCount: (swarmPeerCount) => set({ swarmPeerCount }),
  setNostrRelayCount: (nostrRelayCount) => set({ nostrRelayCount }),
  setTrafficMode: (trafficMode) => set({ trafficMode }),
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
      swarmPeerCount: 0,
      nostrRelayCount: 0,
    }),
}));
