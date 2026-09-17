import { useEffect, useRef, useCallback } from 'react';
import { AppState } from 'react-native';
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
  writeFavoritesToICloud,
  writeListsToICloud,
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

  /** Returns true when either cloud read was unconfirmed (null). */
  const pullAndMerge = useCallback(async (): Promise<boolean> => {
    if (isSyncing.current) return false;
    isSyncing.current = true;
    let unconfirmed = false;
    try {
      const [cloudLists, cloudFavorites] = await Promise.all([
        readListsFromICloud(),
        readFavoritesFromICloud(),
      ]);
      const state = pullState.current;
      // `null` means "not confirmed" (KVS may still be syncing after reinstall).
      unconfirmed = cloudLists === null || cloudFavorites === null;
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
    return unconfirmed;
  }, []);

  /** Push the current local state immediately (used when backgrounding). */
  const flush = useCallback(() => {
    if (!pullState.current.done || isSyncing.current) return;
    void writeListsToICloud(usePlaceListStore.getState().lists);
    void writeFavoritesToICloud(getFavorites());
  }, []);

  // Initial pull. Subscriptions are registered first so no local edit made
  // during the pull window is lost: pushes are held until done === true.
  // After a reinstall, KVS often syncs a moment after launch, so an
  // unconfirmed read is retried a few times before giving up.
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

    let cancelled = false;
    const retryDelays = [0, 1500, 4000, 10000, 25000];
    (async () => {
      for (const delay of retryDelays) {
        if (cancelled) return;
        if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
        if (cancelled) return;
        const unconfirmed = await pullAndMerge();
        if (!unconfirmed) return;
      }
    })();

    // Best-effort flush when leaving the foreground so pending debounced
    // writes reach KVS before the process may be suspended.
    const appStateSub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') flush();
    });

    return () => {
      cancelled = true;
      unsubscribeLists();
      unsubscribeFavorites();
      unsubscribeCloud();
      appStateSub.remove();
    };
  }, [pullAndMerge, pushFavorites, pushLists, flush]);
}
