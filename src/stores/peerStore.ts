import { create } from 'zustand';
import type { PeerNode } from '../models/peer';

interface PeerState {
  localNode: PeerNode | null;
  activePeers: number;
  syncingFeeds: number;
  totalDataServedMb: number;
  isOnline: boolean;

  setLocalNode: (node: PeerNode | null) => void;
  setActivePeers: (count: number) => void;
  setSyncingFeeds: (count: number) => void;
  setTotalDataServedMb: (mb: number) => void;
  setIsOnline: (online: boolean) => void;
}

export const usePeerStore = create<PeerState>((set) => ({
  localNode: null,
  activePeers: 0,
  syncingFeeds: 0,
  totalDataServedMb: 0,
  isOnline: true,

  setLocalNode: (node) => set({ localNode: node }),
  setActivePeers: (count) => set({ activePeers: count }),
  setSyncingFeeds: (count) => set({ syncingFeeds: count }),
  setTotalDataServedMb: (mb) => set({ totalDataServedMb: mb }),
  setIsOnline: (online) => set({ isOnline: online }),
}));
