jest.mock('react-native-mmkv', () => {
  const store = new Map<string, string>();
  return {
    MMKV: jest.fn().mockImplementation(() => ({
      getString: (key: string) => store.get(key),
      set: (key: string, value: string) => {
        store.set(key, value);
      },
      getNumber: () => undefined,
      delete: (key: string) => {
        store.delete(key);
      },
    })),
  };
});

jest.mock('../../src/services/poi/osmFetcher', () => ({
  checkPoiExistsInOsm: jest.fn(),
}));
jest.mock('../../src/services/osm/osmEditService', () => ({
  submitOsmNodeCreate: jest.fn(),
}));

import {
  buildSeedChangesetComment,
  clearPlaceSeedState,
  markPlaceHandled,
  placeSeedKey,
  seedPlaceToOsm,
  wasPlaceSeedHandled,
} from '../../src/services/osm/placeSeedService';
import {
  clearSeedLedger,
  hasSeededOverturePlace,
  recordSeededOverturePlace,
} from '../../src/services/osm/overtureSeedLedger';
import { checkPoiExistsInOsm } from '../../src/services/poi/osmFetcher';
import { submitOsmNodeCreate } from '../../src/services/osm/osmEditService';

const mockExists = checkPoiExistsInOsm as jest.Mock;
const mockCreate = submitOsmNodeCreate as jest.Mock;

const TOKEN = 'osm-token';
const target = {
  lat: 47.6,
  lng: -122.3,
  name: 'Corner Cafe',
  tags: { name: 'Corner Cafe', amenity: 'cafe' },
  overtureId: 'ov-123',
};

describe('placeSeedService', () => {
  beforeEach(() => {
    clearPlaceSeedState();
    clearSeedLedger();
    jest.clearAllMocks();
  });

  it('normalizes the dedup key (precision + case + trim)', () => {
    expect(placeSeedKey(47.600001, -122.300001, '  Corner Cafe ')).toBe(
      placeSeedKey(47.6, -122.3, 'corner cafe'),
    );
  });

  it('submits when the place is not already in OSM', async () => {
    mockExists.mockResolvedValue(false);
    mockCreate.mockResolvedValue({ nodeId: 42, changesetId: 7 });

    const result = await seedPlaceToOsm(target, TOKEN);

    expect(mockExists).toHaveBeenCalledWith(47.6, -122.3, 'Corner Cafe', target.tags);
    expect(mockCreate).toHaveBeenCalledWith(
      TOKEN,
      47.6,
      -122.3,
      target.tags,
      buildSeedChangesetComment(target),
    );
    expect(result).toEqual({ status: 'submitted', nodeId: 42, changesetId: 7 });
    // Recorded in the persistent ledger.
    expect(hasSeededOverturePlace('ov-123')).toBe(true);
  });

  it('skips submission when the place already exists in OSM', async () => {
    mockExists.mockResolvedValue(true);

    const result = await seedPlaceToOsm(target, TOKEN);

    expect(result.status).toBe('exists');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('fails closed (unverified) when the existence check errors', async () => {
    mockExists.mockRejectedValue(new Error('overpass unavailable'));

    const result = await seedPlaceToOsm(target, TOKEN);

    expect(result.status).toBe('unverified');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('dedupes repeated submissions of the same place in a session', async () => {
    mockExists.mockResolvedValue(false);
    mockCreate.mockResolvedValue({ nodeId: 1, changesetId: 2 });

    await seedPlaceToOsm(target, TOKEN);
    const second = await seedPlaceToOsm(target, TOKEN);

    expect(second.status).toBe('skipped');
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('collapses concurrent in-flight submissions', async () => {
    mockExists.mockResolvedValue(false);
    let resolveCreate!: (value: { nodeId: number; changesetId: number }) => void;
    mockCreate.mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );

    const first = seedPlaceToOsm(target, TOKEN);
    const second = await seedPlaceToOsm(target, TOKEN);

    expect(second.status).toBe('skipped');

    resolveCreate({ nodeId: 1, changesetId: 2 });
    expect((await first).status).toBe('submitted');
  });

  it('returns an error result when node creation fails', async () => {
    mockExists.mockResolvedValue(false);
    mockCreate.mockRejectedValue(new Error('401 unauthorized'));

    const result = await seedPlaceToOsm(target, TOKEN);

    expect(result).toEqual({ status: 'error', error: '401 unauthorized' });
  });

  it('skips places the user chose to add manually', async () => {
    markPlaceHandled(target.lat, target.lng, target.name);

    expect(wasPlaceSeedHandled(target.lat, target.lng, target.name)).toBe(true);
    const result = await seedPlaceToOsm(target, TOKEN);

    expect(result.status).toBe('skipped');
    expect(mockExists).not.toHaveBeenCalled();
  });

  it('skips places already recorded in the persistent ledger', async () => {
    recordSeededOverturePlace('ov-123', 99);

    const result = await seedPlaceToOsm(target, TOKEN);

    expect(result.status).toBe('skipped');
    expect(mockExists).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe('buildSeedChangesetComment', () => {
  it('names the place and its primary OSM tag', () => {
    expect(
      buildSeedChangesetComment({
        lat: 0,
        lng: 0,
        name: 'Tranquility Spa 3 Inc',
        tags: { name: 'Tranquility Spa 3 Inc', amenity: 'spa' },
      }),
    ).toBe('Added "Tranquility Spa 3 Inc" (amenity=spa) · Source: Overture');
  });

  it('falls back to the name when there is no primary tag', () => {
    expect(
      buildSeedChangesetComment({
        lat: 0,
        lng: 0,
        name: 'Mystery Place',
        tags: { name: 'Mystery Place' },
      }),
    ).toBe('Added "Mystery Place" · Source: Overture');
  });

  it('trims the name', () => {
    expect(
      buildSeedChangesetComment({
        lat: 0,
        lng: 0,
        name: '  Trimmed  ',
        tags: { name: 'Trimmed', shop: 'bakery' },
      }),
    ).toBe('Added "Trimmed" (shop=bakery) · Source: Overture');
  });
});
