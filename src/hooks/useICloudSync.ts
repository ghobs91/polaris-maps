import { useEffect, useRef, useCallback } from 'react';
import { usePlaceListStore } from '../stores/placeListStore';
import type { PlaceList } from '../models/placeList';
import {
  getFavorites,
  replaceAllFavorites,
  subscribeFavorites,
} from '../services/favorites/favoritesService';
import {
  readFavoritesFromICloud,
  readListsFromICloud,
  scheduleFavoritesSync,
  scheduleICloudSync,
  mergeFavorites,
  mergeLists,
  onICloudChange,
} from '../services/icloud/iCloudSyncService';

/**
 * Hook that syncs place lists and favorites with iCloud.
 * - On mount: pull from iCloud and merge with local.
 * - On local change: debounce-push to iCloud.
 * - On iCloud change event: re-merge.
 *
 * Reinstall safety: pushes are held until the initial pull completes, and
 * an empty local state is never pushed over an unconfirmed cloud state.
 * A `null` cloud read means "no confirmed data" (KVS may still be
 * downloading after reinstall) — not "cloud is empty". Empty pushes are
 * only allowed once the cloud was confirmed empty or this session has
 * seen non-empty data (so an explicit "erase all" still propagates).
 */
export function useICloudSync(): void {
  const isSyncing = useRef(false);
  const pullState = useRef({
    done: false,
    cloudListsEmpty: true,
    cloudFavoritesEmpty: true,
    seenNonEmptyLists: false,
    seenNonEmptyFavorites: false,
  });

  const pushLists = useCallback((lists: PlaceList[]) => {
    const state = pullState.current;
    // Held until the initial pull completes; suppressed while a pull is
    // applying a merge so remote changes don't echo back to the cloud.
    if (!state.done || isSyncing.current) return;
    if (lists.length > 0) {
      state.seenNonEmptyLists = true;
    } else if (!state.cloudListsEmpty && !state.seenNonEmptyLists) {
      // Fresh install with unconfirmed cloud: don't wipe the cloud copy.
      return;
    }
    scheduleICloudSync(lists);
  }, []);

  const pushFavorites = useCallback(() => {
    const state = pullState.current;
    if (!state.done || isSyncing.current) return;
    const favorites = getFavorites();
    if (favorites.length > 0) {
      state.seenNonEmptyFavorites = true;
    } else if (!state.cloudFavoritesEmpty && !state.seenNonEmptyFavorites) {
      return;
    }
    scheduleFavoritesSync(favorites);
  }, []);

  const pullAndMerge = useCallback(async () => {
    if (isSyncing.current) return;
    isSyncing.current = true;
    try {
      const [cloudLists, cloudFavorites] = await Promise.all([
        readListsFromICloud(),
        readFavoritesFromICloud(),
      ]);
      const state = pullState.current;
      state.cloudListsEmpty = !cloudLists || cloudLists.length === 0;
      state.cloudFavoritesEmpty = !cloudFavorites || cloudFavorites.length === 0;

      if (cloudLists && cloudLists.length > 0) {
        const localLists = usePlaceListStore.getState().lists;
        const merged = mergeLists(localLists, cloudLists);
        if (merged.length > 0) state.seenNonEmptyLists = true;
        usePlaceListStore.getState().setLists(merged);
      } else if (usePlaceListStore.getState().lists.length > 0) {
        state.seenNonEmptyLists = true;
      }

      if (cloudFavorites && cloudFavorites.length > 0) {
        const merged = mergeFavorites(getFavorites(), cloudFavorites);
        if (merged.length > 0) state.seenNonEmptyFavorites = true;
        // Writes straight to MMKV; the push guards above see done === false
        // during this initial pull, so no echo push is scheduled. The
        // favorites subscription below fires but is a no-op until done.
        replaceAllFavorites(merged);
      } else if (getFavorites().length > 0) {
        state.seenNonEmptyFavorites = true;
      }
    } finally {
      pullState.current.done = true;
      isSyncing.current = false;
    }
  }, []);

  // Initial pull. Subscriptions are registered first so no local edit made
  // during the pull window is lost: pushes are held until done === true.
  useEffect(() => {
    const unsubscribeLists = usePlaceListStore.subscribe((s) => {
      pushLists(s.lists);
    });
    const unsubscribeFavorites = subscribeFavorites(() => {
      pushFavorites();
    });
    const unsubscribeCloud = onICloudChange(() => {
      void pullAndMerge();
    });
    void pullAndMerge();
    return () => {
      unsubscribeLists();
      unsubscribeFavorites();
      unsubscribeCloud();
    };
  }, [pullAndMerge, pushFavorites, pushLists]);
}
