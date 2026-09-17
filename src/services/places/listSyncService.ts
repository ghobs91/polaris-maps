import { getGun } from '../gun/init';
import { storage } from '../storage/mmkv';
import { usePlaceListStore } from '../../stores/placeListStore';
import type { PlaceList } from '../../models/placeList';

/**
 * Peer sync for SHARED place lists only (Gun namespace per room).
 *
 * Private lists are never published — every entry point checks `isPrivate`
 * and returns early, so an unshared list writes nothing to the P2P store.
 * Received replicas merge through the store's deterministic `applyRemoteList`.
 */

interface Room {
  off: () => void;
}

const openRooms = new Map<string, Room>();
const SECRET_PREFIX = 'list_share_secret_';

function randomSecret(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** Stable room key for a shared list; rotates when sharing is revoked. */
export function shareRoomKey(listId: string): string {
  const storageKey = SECRET_PREFIX + listId;
  let secret = storage.getString(storageKey);
  if (!secret) {
    secret = randomSecret();
    storage.set(storageKey, secret);
  }
  return `${listId}:${secret}`;
}

/** Stop replicating a list and rotate its room key (revoke access). */
export function rotateShareRoom(listId: string): void {
  const roomKey = shareRoomKey(listId);
  closeSharedList(roomKey);
  storage.set(SECRET_PREFIX + listId, randomSecret());
}

export function isSharing(listId: string): boolean {
  return [...openRooms.keys()].some((key) => key.startsWith(`${listId}:`));
}

function stateNode(roomKey: string) {
  const gun = getGun();
  return (gun as any).get('polaris').get('sharedlists').get(roomKey).get('state');
}

/** Subscribe to a shared list's room and publish the local state. */
export function openSharedList(list: PlaceList): void {
  if (list.isPrivate) return;
  try {
    const roomKey = shareRoomKey(list.id);
    const node = stateNode(roomKey);
    node.put(list);
    const listener = node.on((data: unknown) => {
      const remote = data as PlaceList | null;
      if (!remote || typeof remote !== 'object' || remote.id !== list.id) return;
      usePlaceListStore.getState().applyRemoteList(remote);
    });
    openRooms.set(roomKey, { off: () => listener?.off?.() });
  } catch {
    // Gun unavailable — sharing stays local until it connects.
  }
}

/** Publish the latest local state to an already-open room. */
export function publishList(list: PlaceList): void {
  if (list.isPrivate) return;
  try {
    stateNode(shareRoomKey(list.id)).put(list);
  } catch {
    // best-effort
  }
}

export function closeSharedList(roomKey: string): void {
  const room = openRooms.get(roomKey);
  room?.off?.();
  openRooms.delete(roomKey);
}

/** Toggle sharing and start/stop replication accordingly. */
export function setListShared(list: PlaceList, shared: boolean): void {
  usePlaceListStore.getState().setListPrivate(list.id, !shared);
  if (shared) {
    openSharedList({ ...list, isPrivate: false });
  } else {
    rotateShareRoom(list.id);
  }
}
