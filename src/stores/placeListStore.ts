import { create } from 'zustand';
import { storage } from '../services/storage/mmkv';
import type { PlaceList, SavedPlace } from '../models/placeList';

interface PlaceListState {
  lists: PlaceList[];
  /** Replace all lists (used by iCloud sync merge). */
  setLists: (lists: PlaceList[]) => void;
  createList: (name: string, emoji?: string, isPrivate?: boolean) => PlaceList;
  updateList: (id: string, patch: Partial<Pick<PlaceList, 'name' | 'emoji' | 'isPrivate'>>) => void;
  deleteList: (id: string) => void;
  addPlace: (listId: string, place: Omit<SavedPlace, 'id' | 'addedAt'>) => void;
  removePlace: (listId: string, placeId: string) => void;
  updatePlaceNote: (listId: string, placeId: string, note: string) => void;
  /** Update any fields on a saved place (e.g. resolved address/coordinates). */
  updatePlace: (
    listId: string,
    placeId: string,
    patch: Partial<Omit<SavedPlace, 'id' | 'addedAt'>>,
  ) => void;
  /** Move a place between lists. */
  movePlace: (fromListId: string, toListId: string, placeId: string) => void;
  /** Import an entire list (from file import). */
  importList: (list: PlaceList) => void;
  /** Delete every list and all saved places. */
  clearAllLists: () => void;
  /** Get all lists a specific place is saved in. */
  getListsForPlace: (poiUuid: string) => PlaceList[];
}

const STORAGE_KEY = 'place_lists_v1';

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function loadLists(): PlaceList[] {
  const raw = storage.getString(STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as PlaceList[];
  } catch {
    return [];
  }
}

function persistLists(lists: PlaceList[]): void {
  storage.set(STORAGE_KEY, JSON.stringify(lists));
}

export const usePlaceListStore = create<PlaceListState>()((set, get) => ({
  lists: loadLists(),

  setLists: (lists) => {
    set({ lists });
    persistLists(lists);
  },

  createList: (name, emoji, isPrivate = true) => {
    const now = Date.now();
    const newList: PlaceList = {
      id: generateId(),
      name,
      emoji,
      isPrivate: isPrivate ?? true,
      places: [],
      createdAt: now,
      updatedAt: now,
    };
    const updated = [...get().lists, newList];
    set({ lists: updated });
    persistLists(updated);
    return newList;
  },

  updateList: (id, patch) => {
    const updated = get().lists.map((l) =>
      l.id === id ? { ...l, ...patch, updatedAt: Date.now() } : l,
    );
    set({ lists: updated });
    persistLists(updated);
  },

  deleteList: (id) => {
    const updated = get().lists.filter((l) => l.id !== id);
    set({ lists: updated });
    persistLists(updated);
  },

  clearAllLists: () => {
    set({ lists: [] });
    persistLists([]);
  },

  addPlace: (listId, place) => {
    const updated = get().lists.map((l) => {
      if (l.id !== listId) return l;
      // Avoid duplicates by poiUuid or by name+lat+lng
      const alreadyExists = l.places.some(
        (p) =>
          (place.poiUuid && p.poiUuid === place.poiUuid) ||
          (p.name === place.name && p.lat === place.lat && p.lng === place.lng),
      );
      if (alreadyExists) return l;
      const newPlace: SavedPlace = {
        ...place,
        id: generateId(),
        addedAt: Date.now(),
      };
      return { ...l, places: [newPlace, ...l.places], updatedAt: Date.now() };
    });
    set({ lists: updated });
    persistLists(updated);
  },

  removePlace: (listId, placeId) => {
    const updated = get().lists.map((l) =>
      l.id === listId
        ? { ...l, places: l.places.filter((p) => p.id !== placeId), updatedAt: Date.now() }
        : l,
    );
    set({ lists: updated });
    persistLists(updated);
  },

  updatePlaceNote: (listId, placeId, note) => {
    const updated = get().lists.map((l) =>
      l.id === listId
        ? {
            ...l,
            places: l.places.map((p) => (p.id === placeId ? { ...p, note } : p)),
            updatedAt: Date.now(),
          }
        : l,
    );
    set({ lists: updated });
    persistLists(updated);
  },

  updatePlace: (listId, placeId, patch) => {
    const updated = get().lists.map((l) =>
      l.id === listId
        ? {
            ...l,
            places: l.places.map((p) => (p.id === placeId ? { ...p, ...patch } : p)),
            updatedAt: Date.now(),
          }
        : l,
    );
    set({ lists: updated });
    persistLists(updated);
  },

  movePlace: (fromListId, toListId, placeId) => {
    const lists = get().lists;
    const fromList = lists.find((l) => l.id === fromListId);
    const place = fromList?.places.find((p) => p.id === placeId);
    if (!place) return;

    const updated = lists.map((l) => {
      if (l.id === fromListId) {
        return { ...l, places: l.places.filter((p) => p.id !== placeId), updatedAt: Date.now() };
      }
      if (l.id === toListId) {
        return { ...l, places: [place, ...l.places], updatedAt: Date.now() };
      }
      return l;
    });
    set({ lists: updated });
    persistLists(updated);
  },

  importList: (list) => {
    const updated = [...get().lists, list];
    set({ lists: updated });
    persistLists(updated);
  },

  getListsForPlace: (poiUuid) => {
    return get().lists.filter((l) => l.places.some((p) => p.poiUuid === poiUuid));
  },
}));
