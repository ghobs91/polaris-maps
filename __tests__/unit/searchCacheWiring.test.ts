/**
 * unifiedSearch cache wiring tests: repeated and concurrent identical searches
 * must not re-hit network sources, while the local phase always re-queries.
 */

jest.mock('expo-sqlite', () => ({}));
jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getString: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
  })),
}));
jest.mock('../../src/services/storage/mmkv', () => ({
  storage: {
    getString: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
    getBoolean: jest.fn(),
    setBoolean: jest.fn(),
  },
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
jest.mock('../../src/services/poi/poiService', () => ({
  searchPlacesFts: jest.fn(),
}));
jest.mock('../../src/services/poi/categorySearchService', () => ({
  searchByCategory: jest.fn(),
}));
jest.mock('../../src/services/search/photonGeocoder', () => ({
  searchPhoton: jest.fn(),
}));
jest.mock('../../src/services/geocoding/geocodingService', () => ({
  searchAddress: jest.fn(),
}));
jest.mock('../../src/services/poi/overtureFetcher', () => ({
  fetchOverturePlaces: jest.fn(),
}));
jest.mock('../../src/services/poi/osmFetcher', () => ({
  fetchOsmPoisByName: jest.fn(),
}));
jest.mock('../../src/services/geocoding/globalGeocoderService', () => ({
  isGeonamesReady: jest.fn(() => false),
  searchGlobalPlaces: jest.fn(),
}));

import { unifiedSearch } from '../../src/services/search/unifiedSearch';
import { clearSearchCache } from '../../src/services/search/searchCache';
import * as poiService from '../../src/services/poi/poiService';
import * as categorySearchService from '../../src/services/poi/categorySearchService';
import * as photonGeocoder from '../../src/services/search/photonGeocoder';
import * as geocodingService from '../../src/services/geocoding/geocodingService';
import * as overtureFetcher from '../../src/services/poi/overtureFetcher';
import * as osmFetcher from '../../src/services/poi/osmFetcher';

const defaultOpts = { lat: 40.748, lng: -73.985, zoom: 14 };

describe('unifiedSearch cache wiring', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    clearSearchCache();
    (poiService.searchPlacesFts as jest.Mock).mockResolvedValue([]);
    (categorySearchService.searchByCategory as jest.Mock).mockResolvedValue(null);
    (photonGeocoder.searchPhoton as jest.Mock).mockResolvedValue([]);
    (geocodingService.searchAddress as jest.Mock).mockResolvedValue([]);
    (overtureFetcher.fetchOverturePlaces as jest.Mock).mockResolvedValue([]);
    (osmFetcher.fetchOsmPoisByName as jest.Mock).mockResolvedValue([]);
  });

  it('serves a repeated identical search without network requests', async () => {
    await unifiedSearch('coffee', defaultOpts);

    // The category full pass runs once; the local-only pass is never cached.
    expect(categorySearchService.searchByCategory).toHaveBeenCalledTimes(2);
    expect(photonGeocoder.searchPhoton).toHaveBeenCalledTimes(1);
    expect(overtureFetcher.fetchOverturePlaces).toHaveBeenCalledTimes(1);
    expect(osmFetcher.fetchOsmPoisByName).toHaveBeenCalledTimes(1);

    await unifiedSearch('coffee', defaultOpts);

    expect(photonGeocoder.searchPhoton).toHaveBeenCalledTimes(1);
    expect(overtureFetcher.fetchOverturePlaces).toHaveBeenCalledTimes(1);
    expect(osmFetcher.fetchOsmPoisByName).toHaveBeenCalledTimes(1);
    // Local-only pass re-runs (fresh DB), cached full pass does not.
    expect(categorySearchService.searchByCategory).toHaveBeenCalledTimes(3);
    // The local FTS phase is never cached and re-queries every time.
    expect(poiService.searchPlacesFts).toHaveBeenCalledTimes(4);
  });

  it('shares one execution between concurrent identical searches', async () => {
    await Promise.all([unifiedSearch('pizza', defaultOpts), unifiedSearch('pizza', defaultOpts)]);

    expect(photonGeocoder.searchPhoton).toHaveBeenCalledTimes(1);
    expect(overtureFetcher.fetchOverturePlaces).toHaveBeenCalledTimes(1);
    expect(osmFetcher.fetchOsmPoisByName).toHaveBeenCalledTimes(1);
  });

  it('queries fresh sources for a different query', async () => {
    await unifiedSearch('coffee', defaultOpts);
    await unifiedSearch('pizza', defaultOpts);

    // Query-specific sources re-fetch; Overture is viewport-scoped and reuses
    // the same bbox result.
    expect(photonGeocoder.searchPhoton).toHaveBeenCalledTimes(2);
    expect(osmFetcher.fetchOsmPoisByName).toHaveBeenCalledTimes(2);
    expect(overtureFetcher.fetchOverturePlaces).toHaveBeenCalledTimes(1);
  });
});
