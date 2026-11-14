/**
 * Geocoding never reaches the network.
 *
 * This is the invariant that makes geocoding scale: address and reverse lookups
 * are answered from the on-device packs, so the third-party request rate per
 * session is zero regardless of user count. A single accidental `fetch` here
 * reintroduces a per-query cost on somebody else's donation-funded server, so
 * the assertion is deliberately blunt: `global.fetch` must not be called at all.
 */

jest.mock('expo-sqlite', () => ({}));
jest.mock('../../src/services/diagnostics/diagnosticsLog', () => ({
  logDiagnostic: jest.fn(),
}));

const mockSearchDocs = jest.fn();
const mockSearchDocsFuzzy = jest.fn();
const mockHouseNumbersOnStreet = jest.fn();

jest.mock('../../src/services/search/searchIndex', () => ({
  searchDocs: (...args: unknown[]) => mockSearchDocs(...args),
  searchDocsFuzzy: (...args: unknown[]) => mockSearchDocsFuzzy(...args),
  houseNumbersOnStreet: (...args: unknown[]) => mockHouseNumbersOnStreet(...args),
}));

const mockGetFirstAsync = jest.fn();
const mockGetAllAsync = jest.fn();

jest.mock('../../src/services/database/init', () => ({
  getDatabase: jest.fn(async () => ({
    getFirstAsync: (...args: unknown[]) => mockGetFirstAsync(...args),
    getAllAsync: (...args: unknown[]) => mockGetAllAsync(...args),
  })),
}));

import { reverseGeocode, searchAddress } from '../../src/services/geocoding/geocodingService';
import {
  __resetNominatimPolicyForTests,
  isNominatimEnabled,
} from '../../src/services/geocoding/nominatimPolicy';

const reverseRow = {
  id: 7,
  text: '45 School St',
  type: 'address',
  housenumber: '45',
  street: 'School St',
  city: 'Boston',
  state: 'MA',
  postcode: '02108',
  country: 'USA',
  lat: 42.35545,
  lng: -71.0652,
};

const fetchSpy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  __resetNominatimPolicyForTests();
  fetchSpy.mockReset();
  fetchSpy.mockResolvedValue({ ok: true, status: 200, json: async () => [] });
  global.fetch = fetchSpy as unknown as typeof fetch;
  mockGetAllAsync.mockResolvedValue([]);
  mockSearchDocsFuzzy.mockResolvedValue([]);
  mockHouseNumbersOnStreet.mockResolvedValue([]);
});

describe('default posture', () => {
  it('ships with the network address fallback disabled', () => {
    expect(isNominatimEnabled()).toBe(false);
  });
});

describe('reverse geocoding', () => {
  it('answers from the R*Tree without a network call', async () => {
    mockGetFirstAsync.mockImplementation(async (sql: string) =>
      String(sql).includes('geocoding_rtree') ? reverseRow : null,
    );

    const entry = await reverseGeocode(42.35545, -71.0652);

    expect(entry?.text).toBe('45 School St, Boston, MA, 02108');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('keeps a named place name instead of collapsing it to its city', async () => {
    mockGetFirstAsync.mockImplementation(async (sql: string) =>
      String(sql).includes('geocoding_rtree')
        ? {
            ...reverseRow,
            id: 9,
            text: 'Boston Common',
            type: 'place',
            housenumber: null,
            street: null,
            city: 'Boston',
          }
        : null,
    );

    const entry = await reverseGeocode(42.35545, -71.0652);

    expect(entry?.text).toContain('Boston Common');
  });

  it('falls back to the bundled coarse layer instead of going online', async () => {
    mockGetFirstAsync.mockResolvedValue(null);

    const entry = await reverseGeocode(42.3601, -71.0589);

    expect(entry).not.toBeNull();
    expect(entry!.type).toBe('city');
    expect(entry!.country).toBe('United States');
    expect(entry!.state).toBe('Massachusetts');
    // Negative id marks a bundled answer, not a `geocoding_data` row.
    expect(entry!.id).toBe(-1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns null for a point nothing knows about, without a network call', async () => {
    mockGetFirstAsync.mockResolvedValue(null);

    await expect(reverseGeocode(-30, -30)).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('queries every tier before giving up', async () => {
    mockGetFirstAsync.mockResolvedValue(null);

    await reverseGeocode(42.35545, -71.0652);

    // Four tiers, each an indexed probe on the R*Tree.
    expect(mockGetFirstAsync).toHaveBeenCalledTimes(4);
    for (const [sql] of mockGetFirstAsync.mock.calls as [string][]) {
      expect(sql).toContain('geocoding_rtree');
    }
  });
});

describe('forward geocoding', () => {
  it('answers a local address hit without a network call', async () => {
    mockSearchDocs.mockResolvedValue([
      {
        kind: 'address',
        name: null,
        housenumber: '45',
        street: 'School St',
        city: 'Boston',
        state: 'MA',
        postcode: '02108',
        country: 'USA',
        lat: 42.35545,
        lng: -71.0652,
        rank: -3.2,
      },
    ]);

    const results = await searchAddress('45 school st boston', 5, 42.35, -71.06);

    expect(results.length).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns an honest empty result instead of falling back to Nominatim', async () => {
    mockSearchDocs.mockResolvedValue([]);
    mockSearchDocsFuzzy.mockResolvedValue([]);
    mockHouseNumbersOnStreet.mockResolvedValue([]);

    await expect(searchAddress('nowhere in particular', 5, 42.35, -71.06)).resolves.toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
