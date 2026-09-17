/**
 * Tests for `findPlaceIdNear` resolution order: exact name match, then a
 * containment match, then the nearest place within the radius. This backs the
 * place-details / reviews affordance so a tapped POI is rarely a dead end.
 */

jest.mock('../../src/services/gun/init', () => ({ getGun: jest.fn() }));
jest.mock('../../src/services/database/init', () => {
  const db = { getAllAsync: jest.fn(), getFirstAsync: jest.fn(), runAsync: jest.fn() };
  return { getDatabase: jest.fn().mockResolvedValue(db), __mockDb: db };
});

import { findPlaceIdNear } from '../../src/services/poi/poiService';

const { __mockDb: mockDb } = jest.requireMock('../../src/services/database/init') as {
  __mockDb: { getAllAsync: jest.Mock };
};

function row(uuid: string, name: string, lat: number, lng: number) {
  return { uuid, name, lat, lng };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.getAllAsync.mockResolvedValue([]);
});

describe('findPlaceIdNear', () => {
  it('prefers an exact name match', async () => {
    mockDb.getAllAsync.mockResolvedValue([
      row('near', 'Somewhere Else', 40.7, -73.99),
      row('exact', 'King Kullen', 40.7001, -73.9901),
    ]);

    await expect(findPlaceIdNear(40.7, -73.99, 'King Kullen')).resolves.toBe('exact');
  });

  it('falls back to a containment match', async () => {
    mockDb.getAllAsync.mockResolvedValue([
      row('partial', 'King Kullen Pharmacy', 40.7001, -73.9901),
      row('other', 'Nails', 40.70005, -73.99005),
    ]);

    await expect(findPlaceIdNear(40.7, -73.99, 'King Kullen')).resolves.toBe('partial');
  });

  it('falls back to the nearest place in range when the name differs', async () => {
    mockDb.getAllAsync.mockResolvedValue([
      row('far', 'Unrelated', 40.7008, -73.9908),
      row('close', 'Different Name', 40.70002, -73.99002),
    ]);

    await expect(findPlaceIdNear(40.7, -73.99, 'King Kullen')).resolves.toBe('close');
  });

  it('returns null when nothing is within the radius', async () => {
    mockDb.getAllAsync.mockResolvedValue([row('far', 'Unrelated', 41.0, -74.0)]);
    await expect(findPlaceIdNear(40.7, -73.99, 'King Kullen')).resolves.toBeNull();
  });
});
