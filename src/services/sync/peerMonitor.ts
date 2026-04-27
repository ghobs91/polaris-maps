import { usePeerStore } from '../../stores/peerStore';
import { useTrafficStore } from '../../stores/trafficStore';
import { getActiveFeeds } from './feedSyncService';
import { getHyperdriveStatus } from './hyperdriveBridge';

let intervalId: ReturnType<typeof setInterval> | null = null;
let refCount = 0;

async function poll(): Promise<void> {
  try {
    const status = await getHyperdriveStatus();
    const feeds = getActiveFeeds();
    const feedPeers = feeds.reduce((sum, f) => sum + f.peers, 0);
    const trafficPeers = useTrafficStore.getState().swarmPeerCount;

    usePeerStore.getState().setActivePeers(status.swarmConnections + feedPeers + trafficPeers);
    usePeerStore.getState().setSyncingFeeds(Math.max(status.drives.length, feeds.length));
  } catch {
    const feeds = getActiveFeeds();
    const feedPeers = feeds.reduce((sum, f) => sum + f.peers, 0);
    const trafficPeers = useTrafficStore.getState().swarmPeerCount;
    usePeerStore.getState().setActivePeers(feedPeers + trafficPeers);
    usePeerStore.getState().setSyncingFeeds(feeds.length);
  }
}

export function startPeerMonitor(): void {
  refCount++;
  if (intervalId) return;

  poll();
  intervalId = setInterval(poll, 15_000);
}

export function stopPeerMonitor(): void {
  refCount = Math.max(0, refCount - 1);
  if (refCount > 0 || !intervalId) return;

  clearInterval(intervalId);
  intervalId = null;
}
