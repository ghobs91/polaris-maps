/**
 * countryCodeForPosition resolves a sign's unit from the downloaded region that
 * contains the car. Wrong here means a 50 km/h zone read as 50 mph, so the
 * failure modes matter as much as the happy path.
 */
jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(),
}));

jest.mock('../../src/services/database/init', () => {
  const mockDb = {
    getAllAsync: jest.fn(),
    getFirstAsync: jest.fn(),
    runAsync: jest.fn(),
    execAsync: jest.fn(),
  };
  return {
    getDatabase: jest.fn().mockResolvedValue(mockDb),
    __mockDb: mockDb,
  };
});

import { countryCodeForPosition } from '../../src/services/speedLimits/countryForPosition';

const { __mockDb: mockDb } = jest.requireMock('../../src/services/database/init') as {
  __mockDb: { getAllAsync: jest.Mock };
};

describe('countryCodeForPosition', () => {
  beforeEach(() => jest.clearAllMocks());

  it('derives the country from the containing region id', async () => {
    mockDb.getAllAsync.mockResolvedValue([{ id: 'us-ny-new-york' }]);
    await expect(countryCodeForPosition(40.75, -73.99)).resolves.toBe('US');
  });

  it('passes the point inside the bounds predicate', async () => {
    mockDb.getAllAsync.mockResolvedValue([{ id: 'de-berlin' }]);
    await countryCodeForPosition(52.52, 13.405);
    const [, params] = mockDb.getAllAsync.mock.calls[0];
    expect(params).toEqual([52.52, 52.52, 13.405, 13.405]);
  });

  it('returns null outside every downloaded region', async () => {
    mockDb.getAllAsync.mockResolvedValue([]);
    await expect(countryCodeForPosition(0, 0)).resolves.toBeNull();
  });

  it('skips region ids that carry no country prefix', async () => {
    mockDb.getAllAsync.mockResolvedValue([{ id: 'berlin' }, { id: 'de-berlin' }]);
    await expect(countryCodeForPosition(52.52, 13.405)).resolves.toBe('DE');
  });

  it('stays silent when the database is unavailable', async () => {
    mockDb.getAllAsync.mockRejectedValue(new Error('no db'));
    await expect(countryCodeForPosition(40.75, -73.99)).resolves.toBeNull();
  });

  it('rejects non-finite coordinates without querying', async () => {
    await expect(countryCodeForPosition(Number.NaN, 0)).resolves.toBeNull();
    expect(mockDb.getAllAsync).not.toHaveBeenCalled();
  });
});
