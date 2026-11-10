import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { encode as geohashEncode, neighbors as geohashNeighbors } from '../../utils/geohash';
import {
  joinTopic,
  leaveTopic,
  isStarted as isSwarmStarted,
  setNetworkProfile,
} from './hyperswarmBridge';
import { syncSubscriptions as nostrSync } from './nostrFallback';
import { useTrafficStore } from '../../stores/trafficStore';
import { MIN_PEER_THRESHOLD } from '../../models/traffic';
import { isMeteredConnection, selectTrafficCells } from './densityPolicy';

const DEBOUNCE_MS = 500;

const activeSwarmTopics = new Set<string>();
const activeNostrTopics = new Set<string>();
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let networkUnsubscribe: (() => void) | null = null;
let metered = false;
/** Last viewport cells, replayed when the network profile changes. */
let lastCells: string[] = [];

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
  const desiredSet = new Set(selectTrafficCells(desiredCells, metered));
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

function applyNetworkState(state: NetInfoState): void {
  const details = state.details as { isConnectionExpensive?: boolean } | null;
  const nextMetered = isMeteredConnection(state.type, details?.isConnectionExpensive);
  if (nextMetered === metered) return;

  metered = nextMetered;
  // The worklet applies this by re-joining its topics client-only; RN then
  // trims the topic set so a metered link carries the center cell only.
  setNetworkProfile(metered);
  if (lastCells.length > 0) syncTopics(lastCells);
}

/** Start tracking the link type so the mesh can degrade on cellular. */
export function initTopicManager(): void {
  if (networkUnsubscribe) return;
  setNetworkProfile(metered);
  networkUnsubscribe = NetInfo.addEventListener(applyNetworkState);
  void NetInfo.fetch()
    .then(applyNetworkState)
    .catch(() => {
      // NetInfo unavailable — stay on the unmetered profile.
    });
}

/** Stop tracking the link type and leave every topic. */
export function disposeTopicManager(): void {
  networkUnsubscribe?.();
  networkUnsubscribe = null;
  unsubscribeAll();
}

export function onViewportChange(centerLat: number, centerLng: number): void {
  if (debounceTimer) clearTimeout(debounceTimer);

  debounceTimer = setTimeout(() => {
    lastCells = getVisibleGeohash4Cells(centerLat, centerLng);
    syncTopics(lastCells);
  }, DEBOUNCE_MS);
}

export function unsubscribeAll(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  lastCells = [];

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
