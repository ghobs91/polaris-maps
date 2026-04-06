/**
 * Tests for the placeListStore.
 * Uses a mock MMKV to isolate from real storage.
 */

// Mock MMKV — factory self-contained to avoid hoisting issues
jest.mock('../../src/services/storage/mmkv', () => {
  const store = new Map<string, string>();
  return {
    storage: {
      getString: (key: string) => store.get(key),
      set: (key: string, value: string) => store.set(key, value),
      delete: (key: string) => store.delete(key),
    },
    _testClear: () => store.clear(),
    _testGet: (key: string) => store.get(key),
  };
});

import { usePlaceListStore } from '../../src/stores/placeListStore';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { _testClear, _testGet } = require('../../src/services/storage/mmkv') as {
  _testClear: () => void;
  _testGet: (key: string) => string | undefined;
};

describe('placeListStore', () => {
  beforeEach(() => {
    _testClear();
    // Reset the store state
    usePlaceListStore.setState({ lists: [] });
  });

  describe('createList', () => {
    it('creates a new list with correct defaults', () => {
      const store = usePlaceListStore.getState();
      const list = store.createList('Test List', '🍕');

      expect(list.name).toBe('Test List');
      expect(list.emoji).toBe('🍕');
      expect(list.isPrivate).toBe(true);
      expect(list.places).toHaveLength(0);
      expect(usePlaceListStore.getState().lists).toHaveLength(1);
    });

    it('persists to storage', () => {
      usePlaceListStore.getState().createList('Persisted');
      const raw = _testGet('place_lists_v1');
      expect(raw).toBeDefined();
      const parsed = JSON.parse(raw!);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].name).toBe('Persisted');
    });
  });

  describe('addPlace', () => {
    it('adds a place to a list', () => {
      const list = usePlaceListStore.getState().createList('Eats');
      usePlaceListStore.getState().addPlace(list.id, {
        name: 'Pizza Place',
        lat: 40.7128,
        lng: -74.006,
        category: 'restaurant',
      });

      const updated = usePlaceListStore.getState().lists.find((l) => l.id === list.id)!;
      expect(updated.places).toHaveLength(1);
      expect(updated.places[0].name).toBe('Pizza Place');
      expect(updated.places[0].lat).toBe(40.7128);
    });

    it('prevents duplicate by poiUuid', () => {
      const list = usePlaceListStore.getState().createList('Eats');
      const place = { name: 'Pizza', lat: 40, lng: -74, poiUuid: 'poi-123' };
      usePlaceListStore.getState().addPlace(list.id, place);
      usePlaceListStore.getState().addPlace(list.id, place);

      const updated = usePlaceListStore.getState().lists.find((l) => l.id === list.id)!;
      expect(updated.places).toHaveLength(1);
    });

    it('prevents duplicate by name+coords', () => {
      const list = usePlaceListStore.getState().createList('Eats');
      usePlaceListStore.getState().addPlace(list.id, { name: 'X', lat: 1, lng: 2 });
      usePlaceListStore.getState().addPlace(list.id, { name: 'X', lat: 1, lng: 2 });

      const updated = usePlaceListStore.getState().lists.find((l) => l.id === list.id)!;
      expect(updated.places).toHaveLength(1);
    });
  });

  describe('removePlace', () => {
    it('removes a place from a list', () => {
      const list = usePlaceListStore.getState().createList('Eats');
      usePlaceListStore.getState().addPlace(list.id, { name: 'A', lat: 1, lng: 2 });
      const placeId = usePlaceListStore.getState().lists[0].places[0].id;

      usePlaceListStore.getState().removePlace(list.id, placeId);
      expect(usePlaceListStore.getState().lists[0].places).toHaveLength(0);
    });
  });

  describe('updateList', () => {
    it('updates list name and emoji', () => {
      const list = usePlaceListStore.getState().createList('Old Name');
      usePlaceListStore.getState().updateList(list.id, { name: 'New Name', emoji: '🎯' });

      const updated = usePlaceListStore.getState().lists.find((l) => l.id === list.id)!;
      expect(updated.name).toBe('New Name');
      expect(updated.emoji).toBe('🎯');
    });
  });

  describe('deleteList', () => {
    it('removes a list entirely', () => {
      const list = usePlaceListStore.getState().createList('To Delete');
      expect(usePlaceListStore.getState().lists).toHaveLength(1);

      usePlaceListStore.getState().deleteList(list.id);
      expect(usePlaceListStore.getState().lists).toHaveLength(0);
    });
  });

  describe('movePlace', () => {
    it('moves a place between lists', () => {
      const listA = usePlaceListStore.getState().createList('A');
      const listB = usePlaceListStore.getState().createList('B');
      usePlaceListStore.getState().addPlace(listA.id, { name: 'X', lat: 1, lng: 2 });
      const placeId = usePlaceListStore.getState().lists.find((l) => l.id === listA.id)!.places[0]
        .id;

      usePlaceListStore.getState().movePlace(listA.id, listB.id, placeId);

      const aPlaces = usePlaceListStore.getState().lists.find((l) => l.id === listA.id)!.places;
      const bPlaces = usePlaceListStore.getState().lists.find((l) => l.id === listB.id)!.places;
      expect(aPlaces).toHaveLength(0);
      expect(bPlaces).toHaveLength(1);
      expect(bPlaces[0].name).toBe('X');
    });
  });

  describe('updatePlaceNote', () => {
    it('updates a place note', () => {
      const list = usePlaceListStore.getState().createList('Notes');
      usePlaceListStore.getState().addPlace(list.id, { name: 'A', lat: 1, lng: 2 });
      const placeId = usePlaceListStore.getState().lists[0].places[0].id;

      usePlaceListStore.getState().updatePlaceNote(list.id, placeId, 'Updated note');
      const place = usePlaceListStore.getState().lists[0].places[0];
      expect(place.note).toBe('Updated note');
    });
  });

  describe('importList', () => {
    it('imports a full list', () => {
      usePlaceListStore.getState().importList({
        id: 'imported-1',
        name: 'Imported',
        isPrivate: true,
        places: [{ id: 'p1', name: 'Place 1', lat: 1, lng: 2, addedAt: Date.now() }],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      expect(usePlaceListStore.getState().lists).toHaveLength(1);
      expect(usePlaceListStore.getState().lists[0].name).toBe('Imported');
    });
  });

  describe('getListsForPlace', () => {
    it('returns lists containing a specific POI', () => {
      const list1 = usePlaceListStore.getState().createList('A');
      const list2 = usePlaceListStore.getState().createList('B');
      usePlaceListStore
        .getState()
        .addPlace(list1.id, { name: 'X', lat: 1, lng: 2, poiUuid: 'poi-1' });
      usePlaceListStore
        .getState()
        .addPlace(list2.id, { name: 'Y', lat: 3, lng: 4, poiUuid: 'poi-1' });
      usePlaceListStore
        .getState()
        .addPlace(list2.id, { name: 'Z', lat: 5, lng: 6, poiUuid: 'poi-2' });

      const result = usePlaceListStore.getState().getListsForPlace('poi-1');
      expect(result).toHaveLength(2);
    });
  });
});
