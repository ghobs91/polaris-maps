jest.mock('../../src/services/database/init', () => ({ getDatabase: jest.fn() }));

import {
  candidatePlaceKeys,
  canonicalPlaceKey,
  clearPlaceDetailCache,
  countPlaceDetailCache,
  evictPlaceDetails,
  getPlaceDetail,
  putPlaceDetail,
  seedPlaceDetails,
  setPlaceDetailCacheBackend,
  type PlaceDetailCacheBackend,
  type PlaceDetailRow,
} from '../../src/services/places/placeDetailCache';

class InMemoryBackend implements PlaceDetailCacheBackend {
  rows = new Map<string, PlaceDetailRow>();
  async upsert(row: PlaceDetailRow): Promise<void> {
    this.rows.set(row.canonicalId, { ...row });
  }
  async getByKeys(keys: string[]): Promise<PlaceDetailRow[]> {
    return keys.map((k) => this.rows.get(k)).filter((r): r is PlaceDetailRow => r != null);
  }
  async updateAccess(canonicalId: string, at: number): Promise<void> {
    const r = this.rows.get(canonicalId);
    if (r) r.lastAccessed = at;
  }
  async count(): Promise<number> {
    return this.rows.size;
  }
  async deleteMany(ids: string[]): Promise<void> {
    for (const id of ids) this.rows.delete(id);
  }
  async clear(): Promise<void> {
    this.rows.clear();
  }
  async oldest(limit: number): Promise<string[]> {
    return [...this.rows.values()]
      .sort((a, b) => a.lastAccessed - b.lastAccessed)
      .slice(0, limit)
      .map((r) => r.canonicalId);
  }
}

function row(
  overrides: Partial<PlaceDetailRow> = {},
): Omit<PlaceDetailRow, 'cachedAt' | 'lastAccessed'> {
  return {
    canonicalId: 'place:p1',
    placeId: 'p1',
    osmId: null,
    name: 'Cafe',
    lat: 40.7,
    lng: -74,
    snapshot: JSON.stringify({ phone: '555' }),
    media: null,
    reviews: null,
    sourceVersion: 1,
    ...overrides,
  };
}

let backend: InMemoryBackend;
let clock = 1_000_000;

beforeEach(async () => {
  backend = new InMemoryBackend();
  setPlaceDetailCacheBackend(backend);
  clock = 1_000_000;
  jest.spyOn(Date, 'now').mockImplementation(() => clock);
});

afterEach(() => jest.restoreAllMocks());

afterAll(() => setPlaceDetailCacheBackend(null));

describe('canonical keys', () => {
  it('prefers place id, then osm id, then geo', () => {
    expect(canonicalPlaceKey({ placeId: 'p1', lat: 0, lng: 0 })).toBe('place:p1');
    expect(canonicalPlaceKey({ osmId: 'o1', lat: 0, lng: 0 })).toBe('osm:o1');
    expect(canonicalPlaceKey({ lat: 1.234567, lng: 2.345678, name: 'Café' })).toBe(
      'geo:1.23457,2.34568:café',
    );
  });

  it('enumerates every identifier for alias lookups', () => {
    const keys = candidatePlaceKeys({ placeId: 'p1', osmId: 'o1', lat: 0, lng: 0, name: 'X' });
    expect(keys).toContain('place:p1');
    expect(keys).toContain('osm:o1');
    expect(keys.some((k) => k.startsWith('geo:'))).toBe(true);
  });
});

describe('place detail cache', () => {
  it('round-trips a snapshot', async () => {
    await putPlaceDetail(row());
    const found = await getPlaceDetail({ placeId: 'p1', lat: 40.7, lng: -74 });
    expect(found?.snapshot).toBe(JSON.stringify({ phone: '555' }));
  });

  it('resolves one snapshot through aliased identifiers', async () => {
    await putPlaceDetail(row({ canonicalId: 'place:p1', placeId: 'p1', osmId: 'o1' }));
    // Looked up with both ids (e.g. from a saved list vs. search).
    const found = await getPlaceDetail({ placeId: 'p1', osmId: 'o1', lat: 40.7, lng: -74 });
    expect(found).not.toBeNull();
  });

  it('falls back to a geo key when no ids are known', async () => {
    await putPlaceDetail(
      row({ canonicalId: canonicalPlaceKey({ lat: 40.7, lng: -74, name: 'Cafe' }), placeId: null }),
    );
    const found = await getPlaceDetail({ osmId: 'o2', lat: 40.7, lng: -74, name: 'Cafe' });
    expect(found).not.toBeNull();
  });

  it('does not overwrite a newer source version with an older seed', async () => {
    await putPlaceDetail(row({ sourceVersion: 2, snapshot: 'live' }));
    const stored = await putPlaceDetail(row({ sourceVersion: 1, snapshot: 'seed' }));
    expect(stored).toBe(false);
    const found = await getPlaceDetail({ placeId: 'p1', lat: 40.7, lng: -74 });
    expect(found?.snapshot).toBe('live');
  });

  it('seeds from a region pack without overwriting a fresher live snapshot', async () => {
    await putPlaceDetail(row({ sourceVersion: 1, snapshot: 'live' }));

    const seeded = await seedPlaceDetails([
      {
        canonicalId: 'place:p1',
        placeId: 'p1',
        name: 'Cafe',
        lat: 40.7,
        lng: -74,
        snapshot: 'region-pack',
      },
    ]);

    expect(seeded).toBe(0);
    const found = await getPlaceDetail({ placeId: 'p1', lat: 40.7, lng: -74 });
    expect(found?.snapshot).toBe('live');
  });

  it('seeds an empty cache from a region pack', async () => {
    const seeded = await seedPlaceDetails([
      {
        canonicalId: 'place:p1',
        placeId: 'p1',
        name: 'Cafe',
        lat: 40.7,
        lng: -74,
        snapshot: 'region-pack',
      },
    ]);

    expect(seeded).toBe(1);
    const found = await getPlaceDetail({ placeId: 'p1', lat: 40.7, lng: -74 });
    expect(found?.snapshot).toBe('region-pack');
  });

  it('evicts least-recently-accessed snapshots beyond the bound', async () => {
    clock = 1_000;
    await putPlaceDetail(row({ canonicalId: 'place:a', placeId: 'a' }));
    clock = 2_000;
    await putPlaceDetail(row({ canonicalId: 'place:b', placeId: 'b' }));
    clock = 3_000;
    await putPlaceDetail(row({ canonicalId: 'place:c', placeId: 'c' }));
    // Touch `a` so `b` becomes the oldest.
    clock = 4_000;
    await getPlaceDetail({ placeId: 'a', lat: 40.7, lng: -74 });

    const evicted = await evictPlaceDetails(2);

    expect(evicted).toBe(1);
    expect(await countPlaceDetailCache()).toBe(2);
    expect(backend.rows.has('place:b')).toBe(false);
    expect(backend.rows.has('place:a')).toBe(true);
  });

  it('clears all snapshots', async () => {
    await putPlaceDetail(row());
    await clearPlaceDetailCache();
    expect(await countPlaceDetailCache()).toBe(0);
  });
});
