import { encode as geohashEncode, neighbors as geohashNeighbors } from '../../utils/geohash';
import { joinTopic, leaveTopic, isStarted as isSwarmStarted } from './hyperswarmBridge';
import { syncSubscriptions as nostrSync } from './nostrFallback';
import { useTrafficStore } from '../../stores/trafficStore';
import { MIN_PEER_THRESHOLD } from '../../models/traffic';

const DEBOUNCE_MS = 500;
const MAX_TRAFFIC_TOPICS = 9; // geohash4 cells (center + 8 neighbors)

const activeSwarmTopics = new Set<string>();
const activeNostrTopics = new Set<string>();
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function getVisibleGeohash4Cells(centerLat: number, centerLng: number): string[] {
  // Use geohash4 precision (~39km × 20km cells) for traffic topic discovery
  const center = geohashEncode(centerLat, centerLng, 4);
  return [center, ...geohashNeighbors(center)];
}

/**
 * Sync Hyperswarm topics: join new cells, leave old ones.
 * Simultaneously sync Nostr subscriptions for fallback.
 */
function syncTopics(desiredCells: string[]): void {
  const desiredSet = new Set(desiredCells.slice(0, MAX_TRAFFIC_TOPICS));
  const swarmPeerCount = useTrafficStore.getState().swarmPeerCount;

  // Always join Hyperswarm topics (primary)
  if (isSwarmStarted()) {
    const toJoin = [...desiredSet].filter((c) => !activeSwarmTopics.has(c));
    const toLeave = [...activeSwarmTopics].filter((c) => !desiredSet.has(c));

    for (const cell of toLeave) {
      leaveTopic(cell);
      activeSwarmTopics.delete(cell);
    }
    for (const cell of toJoin) {
      joinTopic(cell);
      activeSwarmTopics.add(cell);
    }
  }

  // Nostr fallback — only subscribe when Hyperswarm peers are sparse
  if (swarmPeerCount < MIN_PEER_THRESHOLD) {
    nostrSync(desiredSet);
    for (const c of desiredSet) activeNostrTopics.add(c);
    for (const c of activeNostrTopics) {
      if (!desiredSet.has(c)) activeNostrTopics.delete(c);
    }
  } else {
    // Have enough swarm peers — unsubscribe from Nostr
    if (activeNostrTopics.size > 0) {
      nostrSync(new Set());
      activeNostrTopics.clear();
    }
  }
}

export function onViewportChange(centerLat: number, centerLng: number): void {
  if (debounceTimer) clearTimeout(debounceTimer);

  debounceTimer = setTimeout(() => {
    const cells = getVisibleGeohash4Cells(centerLat, centerLng);
    syncTopics(cells);
  }, DEBOUNCE_MS);
}

export function unsubscribeAll(): void {
  if (debounceTimer) clearTimeout(debounceTimer);

  for (const cell of activeSwarmTopics) {
    leaveTopic(cell);
  }
  activeSwarmTopics.clear();

  nostrSync(new Set());
  activeNostrTopics.clear();
}

export function getActiveTopicCount(): number {
  return activeSwarmTopics.size + activeNostrTopics.size;
}
