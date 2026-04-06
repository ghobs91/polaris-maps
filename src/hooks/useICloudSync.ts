import { useEffect, useRef, useCallback } from 'react';
import { usePlaceListStore } from '../stores/placeListStore';
import {
  readListsFromICloud,
  scheduleICloudSync,
  mergeLists,
  onICloudChange,
} from '../services/icloud/iCloudSyncService';

/**
 * Hook that syncs the place list store with iCloud.
 * - On mount: pull from iCloud and merge with local.
 * - On local change: debounce-push to iCloud.
 * - On iCloud change event: re-merge.
 */
export function useICloudSync(): void {
  const lists = usePlaceListStore((s) => s.lists);
  const setLists = usePlaceListStore((s) => s.setLists);
  const isSyncing = useRef(false);

  const pullAndMerge = useCallback(async () => {
    if (isSyncing.current) return;
    isSyncing.current = true;
    try {
      const cloudLists = await readListsFromICloud();
      if (cloudLists && cloudLists.length > 0) {
        const localLists = usePlaceListStore.getState().lists;
        const merged = mergeLists(localLists, cloudLists);
        setLists(merged);
      }
    } finally {
      isSyncing.current = false;
    }
  }, [setLists]);

  // Initial pull
  useEffect(() => {
    pullAndMerge();
  }, [pullAndMerge]);

  // Push on local changes
  useEffect(() => {
    if (!isSyncing.current) {
      scheduleICloudSync(lists);
    }
  }, [lists]);

  // Listen for iCloud-originated changes
  useEffect(() => {
    return onICloudChange(() => {
      pullAndMerge();
    });
  }, [pullAndMerge]);
}
