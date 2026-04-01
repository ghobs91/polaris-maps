// Mock native/expo modules required by transitive imports
jest.mock('expo-sqlite', () => ({}));
jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getString: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
  })),
}));
jest.mock('../../src/services/database/init', () => ({
  getDatabase: jest.fn(),
}));
jest.mock('../../src/services/gun/init', () => ({
  getGun: jest.fn(),
}));
jest.mock('../../src/services/identity/signing', () => ({
  sign: jest.fn(),
  createSigningPayload: jest.fn(),
}));
jest.mock('../../src/services/identity/keypair', () => ({
  getOrCreateKeypair: jest.fn(),
}));

// Mock the 6 search sources that unifiedSearch calls
jest.mock('../../src/services/poi/poiService');
jest.mock('../../src/services/poi/categorySearchService');
jest.mock('../../src/services/search/photonGeocoder');
jest.mock('../../src/services/geocoding/geocodingService');
jest.mock('../../src/services/poi/overtureFetcher');
jest.mock('../../src/services/poi/osmFetcher');

import { unifiedSearch } from '../../src/services/search/unifiedSearch';
import * as poiService from '../../src/services/poi/poiService';
import * as categorySearchService from '../../src/services/poi/categorySearchService';
import * as photonGeocoder from '../../src/services/search/photonGeocoder';
import * as geocodingService from '../../src/services/geocoding/geocodingService';
import * as overtureFetcher from '../../src/services/poi/overtureFetcher';
import * as osmFetcher from '../../src/services/poi/osmFetcher';
import type { Place } from '../../src/models/poi';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultOpts = { lat: 40.748, lng: -73.985, zoom: 14 };

function makePlace(override: Partial<Place> = {}): Place {
  return {
    uuid: 'p-001',
    name: 'Test Place',
    category: 'cafe',
    lat: 40.748,
    lng: -73.985,
    geohash8: 'dr5rugk0',
    status: 'open',
    source: 'overture',
    authorPubkey: '',
    signature: '',
    createdAt: 1700000000,
    updatedAt: 1700000000,
    reviewCount: 0,
    ...override,
  };
}

function makeOsmPoi(name: string, lat = 40.749, lng = -73.984) {
  return {
    id: Math.floor(Math.random() * 1e9),
    lat,
    lng,
    name,
    type: 'amenity',
    subtype: 'cafe',
    tags: { name, amenity: 'cafe' },
  };
}

function makePhotonResult(name: string, isPoi: boolean, lat = 40.749, lng = -73.984) {
  return {
    poi: makeOsmPoi(name, lat, lng),
    isPoi,
    address: { city: 'New York', state: 'New York' },
    displayText: `${name}, New York`,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('unifiedSearch', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    // Default: all sources return empty
    (poiService.searchPlacesFts as jest.Mock).mockResolvedValue([]);
    (categorySearchService.searchByCategory as jest.Mock).mockResolvedValue(null);
    (photonGeocoder.searchPhoton as jest.Mock).mockResolvedValue([]);
    (geocodingService.searchAddress as jest.Mock).mockResolvedValue([]);
    (overtureFetcher.fetchOverturePlaces as jest.Mock).mockResolvedValue([]);
    (osmFetcher.fetchOsmPoisByName as jest.Mock).mockResolvedValue([]);
  });

  it('returns empty for very short queries', async () => {
    const results = await unifiedSearch('a', defaultOpts);
    expect(results).toHaveLength(0);
  });

  it('returns local FTS results', async () => {
    (poiService.searchPlacesFts as jest.Mock).mockResolvedValue([
      makePlace({ name: 'Starbucks', uuid: 'p-starbucks' }),
    ]);

    const results = await unifiedSearch('Starbucks', defaultOpts);

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((r) => r.name === 'Starbucks')).toBe(true);
  });

  it('returns category search results for known categories', async () => {
    const poi = makeOsmPoi('Java House');
    (categorySearchService.searchByCategory as jest.Mock).mockResolvedValue({
      pois: [poi],
      source: 'overpass',
    });

    const results = await unifiedSearch('coffee', defaultOpts);

    expect(results.some((r) => r.name === 'Java House')).toBe(true);
  });

  it('includes Photon POI results', async () => {
    (photonGeocoder.searchPhoton as jest.Mock).mockResolvedValue([
      makePhotonResult('Café Roma', true),
    ]);

    const results = await unifiedSearch('Cafe Roma', defaultOpts);

    expect(results.some((r) => r.name === 'Café Roma')).toBe(true);
    expect(results.find((r) => r.name === 'Café Roma')?.type).toBe('poi');
  });

  it('includes named non-POI Photon results in scored results', async () => {
    (photonGeocoder.searchPhoton as jest.Mock).mockResolvedValue([
      makePhotonResult('Broadway', false, 40.76, -73.98),
    ]);

    const results = await unifiedSearch('Broadway', defaultOpts);

    // Named Photon results are now scored alongside POIs, not appended as addresses
    const addrResult = results.find((r) => r.name?.includes('Broadway'));
    expect(addrResult).toBeDefined();
    expect(addrResult!.score).toBeGreaterThan(0);
  });

  it('appends address geocoding results', async () => {
    (geocodingService.searchAddress as jest.Mock).mockResolvedValue([
      {
        entry: {
          text: '350 Fifth Avenue',
          lat: 40.748,
          lng: -73.985,
          city: 'New York',
          state: 'NY',
          country: 'US',
        },
        source: 'nominatim',
      },
    ]);

    // Use a name search query (no category match)
    const results = await unifiedSearch('350 Fifth Avenue', defaultOpts);

    expect(results.some((r) => r.name === '350 Fifth Avenue')).toBe(true);
  });

  it('deduplicates results from multiple sources', async () => {
    const localPlace = makePlace({
      name: 'Starbucks',
      lat: 40.748,
      lng: -73.985,
    });
    const photonResult = makePhotonResult('Starbucks', true, 40.7481, -73.9851);

    (poiService.searchPlacesFts as jest.Mock).mockResolvedValue([localPlace]);
    (photonGeocoder.searchPhoton as jest.Mock).mockResolvedValue([photonResult]);

    const results = await unifiedSearch('Starbucks', defaultOpts);

    const starbucksResults = results.filter((r) => r.name === 'Starbucks');
    expect(starbucksResults).toHaveLength(1);
  });

  it('ranks the nearest matching Photon result first', async () => {
    // Simulates "Tanger outlet" where the nearest one (Deer Park, ~20km)
    // should appear above a distant one (Ottawa, Canada)
    const nearResult = makePhotonResult('Tanger Outlet Deer Park', true, 40.762, -73.32);
    const farResult = makePhotonResult('Tanger Outlet Mall', true, 45.346, -75.894);

    (photonGeocoder.searchPhoton as jest.Mock).mockResolvedValue([farResult, nearResult]);

    // User is in Levittown, NY area
    const results = await unifiedSearch('Tanger outlet', {
      lat: 40.725,
      lng: -73.514,
      zoom: 14,
    });

    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results[0].name).toBe('Tanger Outlet Deer Park');
  });

  it('handles failures in individual sources gracefully', async () => {
    // Local FTS throws, but Photon succeeds
    (poiService.searchPlacesFts as jest.Mock).mockRejectedValue(new Error('DB error'));
    (photonGeocoder.searchPhoton as jest.Mock).mockResolvedValue([
      makePhotonResult('Good Coffee', true),
    ]);

    const results = await unifiedSearch('Good Coffee', defaultOpts);

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((r) => r.name === 'Good Coffee')).toBe(true);
  });

  it('respects the limit option', async () => {
    const pois = Array.from({ length: 50 }, (_, i) =>
      makePhotonResult(`Place ${i}`, true, 40.748 + i * 0.001, -73.985),
    );
    (photonGeocoder.searchPhoton as jest.Mock).mockResolvedValue(pois);

    const results = await unifiedSearch('Place', { ...defaultOpts, limit: 5 });

    expect(results.length).toBeLessThanOrEqual(5);
  });

  it('includes score and distanceKm on POI results', async () => {
    (poiService.searchPlacesFts as jest.Mock).mockResolvedValue([makePlace({ name: 'Test Café' })]);

    const results = await unifiedSearch('Test Cafe', defaultOpts);

    const poiResult = results.find((r) => r.type === 'poi');
    if (poiResult) {
      expect(typeof poiResult.score).toBe('number');
      expect(typeof poiResult.distanceKm).toBe('number');
    }
  });

  it('finds "deli" via Overture online fetch when local DB is empty', async () => {
    // Simulates the scenario: user searches "deli" in an area not yet browsed.
    // FTS and category search return nothing, but Overture online fetch has data.
    const deliPlace = makePlace({
      name: 'Turnpike Bagels Deli & Bakery',
      uuid: 'overture-deli-123',
      category: 'deli',
      lat: 40.725,
      lng: -73.534,
    });

    (overtureFetcher.fetchOverturePlaces as jest.Mock).mockResolvedValue([deliPlace]);

    const results = await unifiedSearch('deli', {
      lat: 40.725,
      lng: -73.534,
      zoom: 15,
    });

    expect(results.some((r) => r.name === 'Turnpike Bagels Deli & Bakery')).toBe(true);
  });

  it('includes Overture online results in scored output', async () => {
    const overturePlace = makePlace({
      name: 'Island Black Friday',
      uuid: 'overture-ibf',
      category: 'convenience',
      lat: 40.749,
      lng: -73.984,
    });

    (overtureFetcher.fetchOverturePlaces as jest.Mock).mockResolvedValue([overturePlace]);

    const results = await unifiedSearch('Island Black Friday', defaultOpts);

    expect(results.some((r) => r.name === 'Island Black Friday')).toBe(true);
    expect(results.find((r) => r.name === 'Island Black Friday')!.score).toBeGreaterThan(0);
  });

  it('finds POIs via Overpass name search (source 6)', async () => {
    // The deli is tagged as a bakery in OSM, so category search won't find it.
    // But name search matches "deli" in "Turnpike Bagels Deli & Bakery".
    (osmFetcher.fetchOsmPoisByName as jest.Mock).mockResolvedValue([
      {
        id: 999001,
        lat: 40.725,
        lng: -73.534,
        name: 'Turnpike Bagels Deli & Bakery',
        type: 'shop',
        subtype: 'bakery',
        tags: { name: 'Turnpike Bagels Deli & Bakery', shop: 'bakery' },
      },
    ]);

    const results = await unifiedSearch('deli', {
      lat: 40.725,
      lng: -73.534,
      zoom: 15,
    });

    expect(results.some((r) => r.name === 'Turnpike Bagels Deli & Bakery')).toBe(true);
  });

  it('filters out street results from Photon for category searches', async () => {
    // "deli" maps to a known category. Photon returns a street "Delisle Avenue"
    // and a POI "Joe's Deli". Only the POI should survive.
    (photonGeocoder.searchPhoton as jest.Mock).mockResolvedValue([
      {
        poi: {
          id: 800001,
          lat: 40.73,
          lng: -73.52,
          name: 'Delisle Avenue',
          type: 'highway',
          subtype: 'residential',
          tags: { name: 'Delisle Avenue', highway: 'residential' },
        },
        isPoi: false,
        address: { city: 'Roosevelt', state: 'New York' },
        displayText: 'Delisle Avenue, Roosevelt',
      },
      {
        poi: {
          id: 800002,
          lat: 40.726,
          lng: -73.535,
          name: "Joe's Deli",
          type: 'shop',
          subtype: 'deli',
          tags: { name: "Joe's Deli", shop: 'deli' },
        },
        isPoi: true,
        address: { city: 'Levittown', state: 'New York' },
        displayText: "Joe's Deli, Levittown",
      },
    ]);

    const results = await unifiedSearch('deli', {
      lat: 40.725,
      lng: -73.534,
      zoom: 15,
    });

    expect(results.some((r) => r.name === "Joe's Deli")).toBe(true);
    expect(results.some((r) => r.name === 'Delisle Avenue')).toBe(false);
  });
});
