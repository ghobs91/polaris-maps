import { joinFeed, leaveFeed, getEntry } from '../../native/hypercore';
import { updatePeerMetrics } from './peerService';

interface FeedState {
  feedKey: string;
  regionId: string;
  downloaded: number;
  total: number;
  bytesDownloaded: number;
  peers: number;
}

const activeFeeds = new Map<string, FeedState>();

export function getActiveFeeds(): FeedState[] {
  return Array.from(activeFeeds.values());
}

export async function joinRegionFeed(regionId: string, feedKey: string): Promise<void> {
  if (activeFeeds.has(feedKey)) return;

  const state: FeedState = {
    feedKey,
    regionId,
    downloaded: 0,
    total: 0,
    bytesDownloaded: 0,
    peers: 0,
  };
  activeFeeds.set(feedKey, state);

  await joinFeed(feedKey, (event) => {
    handleFeedEvent(feedKey, event);
  });
}

export async function leaveRegionFeed(feedKey: string): Promise<void> {
  activeFeeds.delete(feedKey);
  await leaveFeed(feedKey);
}

export async function fetchEntry(feedKey: string, seq: number): Promise<Uint8Array | null> {
  return getEntry(feedKey, seq);
}

export function getFeedState(feedKey: string): FeedState | undefined {
  return activeFeeds.get(feedKey);
}

function handleFeedEvent(
  feedKey: string,
  event: {
    type: string;
    progress?: { downloaded: number; total: number; bytesDownloaded: number };
    peers?: number;
  },
): void {
  const state = activeFeeds.get(feedKey);
  if (!state) return;

  if (event.type === 'sync-progress' && event.progress) {
    state.downloaded = event.progress.downloaded;
    state.total = event.progress.total;
    state.bytesDownloaded = event.progress.bytesDownloaded;
  }

  if (event.type === 'sync-complete') {
    updatePeerMetrics({ dataServedBytes: state.bytesDownloaded }).catch(() => {});
  }

  if (event.peers !== undefined) {
    state.peers = event.peers;
  }
}
