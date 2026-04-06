import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import type { PlaceList } from '../../models/placeList';

const CLOUD_FILE = 'place_lists.json';

interface CloudStoreModule {
  isAvailable(): Promise<boolean>;
  write(filename: string, data: string): Promise<boolean>;
  read(filename: string): Promise<string | null>;
  remove(filename: string): Promise<boolean>;
  pickDocument(): Promise<{ content: string; name: string } | null>;
}

const CloudStore: CloudStoreModule | null =
  Platform.OS === 'ios' ? NativeModules.PolarisCloudStore : null;

let emitter: NativeEventEmitter | null = null;
function getEmitter(): NativeEventEmitter | null {
  if (Platform.OS !== 'ios' || !CloudStore) return null;
  if (!emitter) {
    emitter = new NativeEventEmitter(NativeModules.PolarisCloudStore);
  }
  return emitter;
}

export async function isICloudAvailable(): Promise<boolean> {
  if (!CloudStore) return false;
  try {
    return await CloudStore.isAvailable();
  } catch {
    return false;
  }
}

export async function writeListsToICloud(lists: PlaceList[]): Promise<boolean> {
  if (!CloudStore) return false;
  try {
    const available = await CloudStore.isAvailable();
    if (!available) return false;
    const json = JSON.stringify(lists);
    return await CloudStore.write(CLOUD_FILE, json);
  } catch {
    return false;
  }
}

export async function readListsFromICloud(): Promise<PlaceList[] | null> {
  if (!CloudStore) return null;
  try {
    const available = await CloudStore.isAvailable();
    if (!available) return null;
    const raw = await CloudStore.read(CLOUD_FILE);
    if (!raw) return null;
    return JSON.parse(raw) as PlaceList[];
  } catch {
    return null;
  }
}

/**
 * Merge cloud lists with local lists.
 * Strategy: cloud wins for lists with same ID but newer updatedAt;
 * lists only in one side are preserved.
 */
export function mergeLists(local: PlaceList[], cloud: PlaceList[]): PlaceList[] {
  const merged = new Map<string, PlaceList>();

  for (const list of local) {
    merged.set(list.id, list);
  }

  for (const cloudList of cloud) {
    const existing = merged.get(cloudList.id);
    if (!existing || cloudList.updatedAt > existing.updatedAt) {
      merged.set(cloudList.id, cloudList);
    }
  }

  return Array.from(merged.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

let syncDebounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Debounced write to iCloud. Batches rapid updates.
 */
export function scheduleICloudSync(lists: PlaceList[]): void {
  if (syncDebounceTimer) clearTimeout(syncDebounceTimer);
  syncDebounceTimer = setTimeout(() => {
    writeListsToICloud(lists);
  }, 2000);
}

/**
 * Subscribe to iCloud file change events.
 * Returns unsubscribe function.
 */
export function onICloudChange(callback: () => void): () => void {
  const em = getEmitter();
  if (!em) return () => {};
  const sub = em.addListener('onCloudStoreChange', callback);
  return () => sub.remove();
}
