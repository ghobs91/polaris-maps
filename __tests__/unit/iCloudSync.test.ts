jest.mock('react-native', () => ({
  NativeModules: {},
  NativeEventEmitter: jest.fn(),
  Platform: { OS: 'ios' },
}));

import { mergeLists } from '../../src/services/icloud/iCloudSyncService';
import type { PlaceList } from '../../src/models/placeList';

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
