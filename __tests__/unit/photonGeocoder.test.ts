// Mock native/expo modules
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

import { searchPhoton } from '../../src/services/search/photonGeocoder';

// ---------------------------------------------------------------------------
// Mock global.fetch
// ---------------------------------------------------------------------------
const mockFetch = jest.fn();
global.fetch = mockFetch as any;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function photonResponse(features: any[] = []) {
  return {
    ok: true,
    json: async () => ({ type: 'FeatureCollection', features }),
  };
}

function photonFeature(opts: {
  name?: string;
  osmKey: string;
  osmValue: string;
  lat?: number;
  lng?: number;
  city?: string;
}) {
  return {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [opts.lng ?? -73.985, opts.lat ?? 40.748],
    },
    properties: {
      osm_id: Math.floor(Math.random() * 1e9),
      osm_type: 'N',
      osm_key: opts.osmKey,
      osm_value: opts.osmValue,
      name: opts.name,
      city: opts.city ?? 'New York',
      state: 'New York',
      country: 'United States',
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('searchPhoton', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('returns POI results for amenity-class features', async () => {
    mockFetch.mockResolvedValue(
      photonResponse([
        photonFeature({
          name: 'Starbucks',
          osmKey: 'amenity',
          osmValue: 'cafe',
        }),
      ]),
    );

    const results = await searchPhoton('Starbucks', 40.748, -73.985);

    expect(results).toHaveLength(1);
    expect(results[0].isPoi).toBe(true);
    expect(results[0].poi.name).toBe('Starbucks');
    expect(results[0].poi.type).toBe('amenity');
    expect(results[0].poi.subtype).toBe('cafe');
  });

  it('marks non-POI features (e.g. place, boundary) as isPoi=false', async () => {
    mockFetch.mockResolvedValue(
      photonResponse([
        photonFeature({
          name: 'New York',
          osmKey: 'place',
          osmValue: 'city',
        }),
      ]),
    );

    const results = await searchPhoton('New York', 40.748, -73.985);

    expect(results).toHaveLength(1);
    expect(results[0].isPoi).toBe(false);
  });

  it('builds correct address structure from Photon properties', async () => {
    mockFetch.mockResolvedValue(
      photonResponse([
        photonFeature({
          name: 'Cafe Roma',
          osmKey: 'amenity',
          osmValue: 'cafe',
          city: 'Brooklyn',
        }),
      ]),
    );

    const results = await searchPhoton('Cafe Roma', 40.748, -73.985);

    expect(results[0].address.city).toBe('Brooklyn');
    expect(results[0].address.country).toBe('United States');
  });

  it('returns empty array for empty query', async () => {
    const results = await searchPhoton('', 40.748, -73.985);
    expect(results).toHaveLength(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns empty array on network failure', async () => {
    mockFetch.mockRejectedValue(new Error('network error'));

    const results = await searchPhoton('coffee', 40.748, -73.985);
    expect(results).toHaveLength(0);
  });

  it('returns empty array on non-ok response', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });

    const results = await searchPhoton('coffee', 40.748, -73.985);
    expect(results).toHaveLength(0);
  });

  it('passes location bias, zoom, and limit to the API', async () => {
    mockFetch.mockResolvedValue(photonResponse([]));

    await searchPhoton('test', 51.5, -0.12, 14, 15, 'en');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('q=test');
    expect(url).toContain('lat=51.5');
    expect(url).toContain('lon=-0.12');
    expect(url).toContain('zoom=14');
    expect(url).toContain('limit=15');
    expect(url).toContain('lang=en');
  });

  it('filters out features without name or housenumber', async () => {
    mockFetch.mockResolvedValue(
      photonResponse([
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-73.985, 40.748] },
          properties: {
            osm_id: 1,
            osm_type: 'R',
            osm_key: 'boundary',
            osm_value: 'administrative',
            // no name, no housenumber
          },
        },
      ]),
    );

    const results = await searchPhoton('something', 40.748, -73.985);
    expect(results).toHaveLength(0);
  });

  it('correctly classifies shop and tourism as POI keys', async () => {
    mockFetch.mockResolvedValue(
      photonResponse([
        photonFeature({ name: 'Bookshop', osmKey: 'shop', osmValue: 'books' }),
        photonFeature({ name: 'Museum', osmKey: 'tourism', osmValue: 'museum' }),
      ]),
    );

    const results = await searchPhoton('test', 40.748, -73.985);
    expect(results).toHaveLength(2);
    expect(results[0].isPoi).toBe(true);
    expect(results[1].isPoi).toBe(true);
  });
});
