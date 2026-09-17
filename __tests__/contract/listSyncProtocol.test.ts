/**
 * Contract tests for the shared-list P2P boundary: the Gun message shape and
 * merge determinism. The Gun transport is mocked, so these assert the exact
 * path/namespace and the payload written for a shared list.
 */

const mockPut = jest.fn();
let mockPath: string[] = [];
let mockRemoteListeners: Array<(data: unknown) => void> = [];

jest.mock('../../src/services/gun/init', () => {
  const chain: any = {};
  chain.get = (key: string) => {
    mockPath.push(key);
    return chain;
  };
  chain.put = (payload: unknown) => {
    mockPut([...mockPath], payload);
    return chain;
  };
  chain.on = (cb: (data: unknown) => void) => {
    mockRemoteListeners.push(cb);
    return { off: jest.fn() };
  };
  return { getGun: () => chain };
});

const mockStore = {
  applyRemoteList: jest.fn(),
  setListPrivate: jest.fn(),
};

jest.mock('../../src/stores/placeListStore', () => ({
  usePlaceListStore: { getState: () => mockStore },
}));

jest.mock('../../src/services/storage/mmkv', () => ({
  storage: {
    getString: jest.fn(),
    set: jest.fn(),
  },
}));

import {
  isSharing,
  openSharedList,
  publishList,
  rotateShareRoom,
  shareRoomKey,
  setListShared,
} from '../../src/services/places/listSyncService';
import { mergeList } from '../../src/services/places/placeListMerge';
import { storage } from '../../src/services/storage/mmkv';
import type { PlaceList, SavedPlace } from '../../src/models/placeList';

const mockStorageGet = storage.getString as jest.Mock;
const mockStorageSet = storage.set as jest.Mock;

function place(overrides: Partial<SavedPlace> = {}): SavedPlace {
  return {
    id: 'p1',
    name: 'Cafe',
    lat: 48.85,
    lng: 2.35,
    addedAt: 1000,
    ...overrides,
  };
}

function list(overrides: Partial<PlaceList> = {}): PlaceList {
  return {
    id: 'list-1',
    name: 'Trip',
    emoji: '🧭',
    isPrivate: false,
    places: [place()],
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPath = [];
  mockRemoteListeners = [];
  mockStorageGet.mockReturnValue(undefined);
});

describe('shared-list wire format', () => {
  it('writes the full list to the room-scoped Gun state node', () => {
    const shared = list();

    publishList(shared);

    expect(mockPut).toHaveBeenCalledWith(
      ['polaris', 'sharedlists', expect.stringContaining('list-1:'), 'state'],
      shared,
    );
  });

  it('never writes a private list to the P2P store', () => {
    publishList(list({ isPrivate: true }));
    openSharedList(list({ isPrivate: true }));

    expect(mockPut).not.toHaveBeenCalled();
    expect(isSharing('list-1')).toBe(false);
  });

  it('subscribes to the room and applies a matching remote replica', () => {
    const shared = list();

    openSharedList(shared);

    expect(isSharing('list-1')).toBe(true);
    expect(mockRemoteListeners).toHaveLength(1);

    const remote = list({ name: 'Trip v2', updatedAt: 2000 });
    mockRemoteListeners[0](remote);

    expect(mockStore.applyRemoteList).toHaveBeenCalledWith(remote);
  });

  it('ignores remote payloads for a different list id', () => {
    openSharedList(list());
    mockRemoteListeners[0](list({ id: 'other-list', name: 'Nope' }));

    expect(mockStore.applyRemoteList).not.toHaveBeenCalled();
  });

  it('derives a stable room key and rotates the secret on revoke', () => {
    mockStorageGet.mockReturnValueOnce('secret-1').mockReturnValueOnce('secret-1');
    const first = shareRoomKey('list-1');
    const second = shareRoomKey('list-1');
    expect(first).toBe('list-1:secret-1');
    expect(second).toBe('list-1:secret-1');

    rotateShareRoom('list-1');
    // The rotated secret is persisted; the old room key is no longer current.
    expect(mockStorageSet).toHaveBeenCalledWith('list_share_secret_list-1', expect.any(String));
  });

  it('toggles sharing through the store and opens the room', () => {
    setListShared(list({ isPrivate: true }), true);

    expect(mockStore.setListPrivate).toHaveBeenCalledWith('list-1', false);
    expect(isSharing('list-1')).toBe(true);
  });
});

describe('merge determinism at the boundary', () => {
  it('is order-independent for shuffled concurrent edits', () => {
    const a = list({
      places: [
        place({ id: 'p1', name: 'A', updatedAt: 2000 }),
        place({ id: 'p2', name: 'B', lng: 2.36, updatedAt: 1500 }),
      ],
      updatedAt: 2000,
    });
    const b = list({
      places: [
        place({ id: 'p2', name: 'B', lng: 2.36, updatedAt: 1800 }),
        place({ id: 'p3', name: 'C', lng: 2.37, addedAt: 1200 }),
      ],
      updatedAt: 1800,
    });

    expect(mergeList(a, b)).toEqual(mergeList(b, a));
  });

  it('breaks metadata ties deterministically by id', () => {
    const a = list({ id: 'aaa', name: 'From A', updatedAt: 5000 });
    const b = list({ id: 'zzz', name: 'From Z', updatedAt: 5000 });

    const merged = mergeList(a, b);
    expect(merged.name).toBe('From Z');
    expect(mergeList(b, a)).toEqual(merged);
  });

  it('drops tombstones so a deleted place is never resurrected', () => {
    const live = list({ places: [place({ id: 'p1', updatedAt: 1000 })] });
    const removed = list({
      places: [place({ id: 'p1', deleted: true, updatedAt: 2000 })],
      updatedAt: 2000,
    });

    expect(mergeList(live, removed).places).toHaveLength(0);
    expect(mergeList(removed, live).places).toHaveLength(0);
  });

  it('collapses concurrent adds of the same coordinate+name to one entry', () => {
    const a = list({ places: [place({ id: 'a1', name: 'Cafe', updatedAt: 1000 })] });
    const b = list({ places: [place({ id: 'b1', name: 'cafe', updatedAt: 1100 })] });

    const merged = mergeList(a, b);
    expect(merged.places).toHaveLength(1);
    expect(merged.places[0].id).toBe('b1');
  });
});
