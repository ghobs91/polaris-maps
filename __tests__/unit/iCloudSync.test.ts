jest.mock('react-native', () => ({
  NativeModules: {},
  NativeEventEmitter: jest.fn(),
  Platform: { OS: 'ios' },
}));

import {
  mergeFavorites,
  mergeLists,
  utf8ByteLength,
} from '../../src/services/icloud/iCloudSyncService';
import type { PlaceList } from '../../src/models/placeList';
import type { FavoriteLocation } from '../../src/services/favorites/favoritesService';

describe('iCloudSyncService - mergeLists', () => {
  const now = Date.now();

  function makeList(overrides: Partial<PlaceList>): PlaceList {
    return {
      id: 'list-1',
      name: 'Test',
      isPrivate: true,
      places: [],
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  it('preserves lists that exist only locally', () => {
    const local = [makeList({ id: 'local-only', name: 'Local' })];
    const cloud: PlaceList[] = [];
    const result = mergeLists(local, cloud);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('local-only');
  });

  it('preserves lists that exist only in cloud', () => {
    const local: PlaceList[] = [];
    const cloud = [makeList({ id: 'cloud-only', name: 'Cloud' })];
    const result = mergeLists(local, cloud);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('cloud-only');
  });

  it('uses cloud version when it is newer', () => {
    const local = [makeList({ id: 'shared', name: 'Local Version', updatedAt: now })];
    const cloud = [makeList({ id: 'shared', name: 'Cloud Version', updatedAt: now + 1000 })];
    const result = mergeLists(local, cloud);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Cloud Version');
  });

  it('keeps local version when it is newer', () => {
    const local = [makeList({ id: 'shared', name: 'Local Newer', updatedAt: now + 2000 })];
    const cloud = [makeList({ id: 'shared', name: 'Cloud Older', updatedAt: now })];
    const result = mergeLists(local, cloud);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Local Newer');
  });

  it('merges multiple lists from both sources', () => {
    const local = [
      makeList({ id: 'a', name: 'A', updatedAt: now }),
      makeList({ id: 'b', name: 'B', updatedAt: now }),
    ];
    const cloud = [
      makeList({ id: 'b', name: 'B Updated', updatedAt: now + 1000 }),
      makeList({ id: 'c', name: 'C', updatedAt: now }),
    ];
    const result = mergeLists(local, cloud);
    expect(result).toHaveLength(3);
    const names = result.map((l) => l.name);
    expect(names).toContain('A');
    expect(names).toContain('B Updated');
    expect(names).toContain('C');
  });

  it('sorts results by updatedAt descending', () => {
    const local = [
      makeList({ id: 'old', name: 'Old', updatedAt: now - 5000 }),
      makeList({ id: 'new', name: 'New', updatedAt: now }),
    ];
    const result = mergeLists(local, []);
    expect(result[0].name).toBe('New');
    expect(result[1].name).toBe('Old');
  });
});

describe('iCloudSyncService - mergeFavorites', () => {
  function makeFavorite(overrides: Partial<FavoriteLocation>): FavoriteLocation {
    return {
      id: 'fav-1',
      kind: 'pin',
      label: 'Test',
      entry: {
        id: 1,
        text: 'Test Place',
        type: 'place',
        housenumber: null,
        street: null,
        city: null,
        state: null,
        postcode: null,
        country: null,
        lat: 42.36,
        lng: -71.06,
      },
      ...overrides,
    };
  }

  it('restores cloud favorites on a fresh install (empty local)', () => {
    const local: FavoriteLocation[] = [];
    const cloud = [
      makeFavorite({ id: 'home', kind: 'home', label: 'Home' }),
      makeFavorite({ id: 'pin-1', kind: 'pin', label: 'Coffee' }),
    ];
    const result = mergeFavorites(local, cloud);
    expect(result).toHaveLength(2);
    expect(result.map((f) => f.id)).toEqual(expect.arrayContaining(['home', 'pin-1']));
  });

  it('preserves local-only favorites', () => {
    const local = [makeFavorite({ id: 'local-pin', label: 'Local' })];
    const result = mergeFavorites(local, []);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('local-pin');
  });

  it('unions favorites unique to each side', () => {
    const local = [makeFavorite({ id: 'local-pin', label: 'Local' })];
    const cloud = [makeFavorite({ id: 'cloud-pin', label: 'Cloud' })];
    const result = mergeFavorites(local, cloud);
    expect(result).toHaveLength(2);
  });

  it('keeps the local entry on same-ID conflicts', () => {
    const local = [makeFavorite({ id: 'shared', label: 'Local Name' })];
    const cloud = [makeFavorite({ id: 'shared', label: 'Cloud Name' })];
    const result = mergeFavorites(local, cloud);
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('Local Name');
  });

  it('orders Home first, Work second, pins after', () => {
    const local = [
      makeFavorite({ id: 'pin-1', kind: 'pin', label: 'Coffee' }),
      makeFavorite({ id: 'work', kind: 'work', label: 'Work' }),
    ];
    const cloud = [makeFavorite({ id: 'home', kind: 'home', label: 'Home' })];
    const result = mergeFavorites(local, cloud);
    expect(result.map((f) => f.id)).toEqual(['home', 'work', 'pin-1']);
  });
});

describe('iCloudSyncService - utf8ByteLength', () => {
  it('measures ASCII strings in bytes', () => {
    expect(utf8ByteLength('hello')).toBe(5);
    expect(utf8ByteLength('')).toBe(0);
  });

  it('counts multibyte characters', () => {
    expect(utf8ByteLength('☁️')).toBeGreaterThan(2);
    expect(utf8ByteLength('café')).toBe(5);
  });
});
