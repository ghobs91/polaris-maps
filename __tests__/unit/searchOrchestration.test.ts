/**
 * Search orchestration tests.
 *
 * Exercises the two-phase `unifiedSearch` contract with deterministic,
 * controllable sources: local results are emitted via `onPartial` while
 * network sources are still pending, `localOnly` never emits a partial, and
 * an aborted search rejects without further emissions.
 *
 * These tests document the current contract and are extended as staged
 * emission lands (task group 4).
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
jest.mock('../../src/services/regions/regionRepository', () => ({
  getRegionContainingPoint: jest.fn(),
}));
jest.mock('../../src/services/geocoding/globalGeocoderService', () => ({
  isGeonamesReady: jest.fn(() => false),
  searchGlobalPlaces: jest.fn(),
  ensureGeonamesDb: jest.fn(),
}));

import { unifiedSearch, type UnifiedSearchResult } from '../../src/services/search/unifiedSearch';
import { abortError, isAbortError } from '../../src/services/search/abortUtils';
import { clearSearchCache } from '../../src/services/search/searchCache';
import * as poiService from '../../src/services/poi/poiService';
import * as categorySearchService from '../../src/services/poi/categorySearchService';
import * as photonGeocoder from '../../src/services/search/photonGeocoder';
import * as geocodingService from '../../src/services/geocoding/geocodingService';
import * as overtureFetcher from '../../src/services/poi/overtureFetcher';
import * as osmFetcher from '../../src/services/poi/osmFetcher';
import * as regionRepository from '../../src/services/regions/regionRepository';
import * as globalGeocoder from '../../src/services/geocoding/globalGeocoderService';
import type { Place } from '../../src/models/poi';
import type { OsmPoi } from '../../src/services/poi/osmFetcher';
import type { PhotonResult } from '../../src/services/search/photonGeocoder';

const defaultOpts = { lat: 40.748, lng: -73.985, zoom: 14 };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function makePlace(name: string, lat = 40.748, lng = -73.985): Place {
  return {
    uuid: `place-${name}`,
    name,
    category: 'cafe',
    lat,
    lng,
    geohash8: 'dr5rugk0',
    status: 'open',
    source: 'overture',
    authorPubkey: '',
    signature: '',
    createdAt: 1_700_000_000,
    updatedAt: 1_700_000_000,
    reviewCount: 0,
  };
}

function makePhotonResult(name: string, lat = 40.75, lng = -73.984): PhotonResult {
  return {
    poi: {
      id: 12345,
      lat,
      lng,
      name,
      type: 'amenity',
      subtype: 'cafe',
      tags: { name, amenity: 'cafe' },
    },
    isPoi: true,
    address: { city: 'New York' },
    displayText: `${name}, New York`,
  };
}

describe('unifiedSearch orchestration', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    clearSearchCache();
    (poiService.searchPlacesFts as jest.Mock).mockResolvedValue([]);
    (categorySearchService.searchByCategory as jest.Mock).mockResolvedValue(null);
    (photonGeocoder.searchPhoton as jest.Mock).mockResolvedValue([]);
    (geocodingService.searchAddress as jest.Mock).mockResolvedValue([]);
    (overtureFetcher.fetchOverturePlaces as jest.Mock).mockResolvedValue([]);
    (osmFetcher.fetchOsmPoisByName as jest.Mock).mockResolvedValue([]);
    (regionRepository.getRegionContainingPoint as jest.Mock).mockResolvedValue(null);
  });

  it('emits local results via onPartial while network sources are pending', async () => {
    (poiService.searchPlacesFts as jest.Mock).mockResolvedValue([makePlace('Local Cafe')]);

    const photon = deferred<PhotonResult[]>();
    (photonGeocoder.searchPhoton as jest.Mock).mockReturnValue(photon.promise);

    const partials: UnifiedSearchResult[][] = [];
    const searchPromise = unifiedSearch('coffee', {
      ...defaultOpts,
      onPartial: (partial) => partials.push(partial),
    });

    await flush();
    expect(partials).toHaveLength(1);
    expect(partials[0].map((r) => r.name)).toContain('Local Cafe');
    expect(photonGeocoder.searchPhoton).toHaveBeenCalled();

    // Network phase is still pending — the final promise has not settled.
    let settled = false;
    void searchPromise.then(() => {
      settled = true;
    });
    await flush();
    expect(settled).toBe(false);

    photon.resolve([makePhotonResult('Online Cafe')]);
    const results = await searchPromise;
    expect(results.map((r) => r.name)).toEqual(
      expect.arrayContaining(['Local Cafe', 'Online Cafe']),
    );
  });

  it('does not emit a partial when localOnly is set', async () => {
    (poiService.searchPlacesFts as jest.Mock).mockResolvedValue([makePlace('Local Cafe')]);

    const onPartial = jest.fn();
    const results = await unifiedSearch('coffee', {
      ...defaultOpts,
      localOnly: true,
      onPartial,
    });

    expect(onPartial).not.toHaveBeenCalled();
    expect(results.map((r) => r.name)).toContain('Local Cafe');
  });

  it('rejects with AbortError when superseded and emits nothing further', async () => {
    (poiService.searchPlacesFts as jest.Mock).mockResolvedValue([makePlace('Local Cafe')]);

    // Abort-aware Photon mock: rejects as soon as the search is superseded.
    const photon = deferred<PhotonResult[]>();
    (photonGeocoder.searchPhoton as jest.Mock).mockImplementation(
      (
        _q: string,
        _lat: number,
        _lng: number,
        _z: number,
        _l: number,
        _lang: string,
        _tag: string,
        opts?: { signal?: AbortSignal },
      ) => {
        opts?.signal?.addEventListener('abort', () => photon.reject(abortError()), { once: true });
        return photon.promise;
      },
    );

    const controller = new AbortController();
    const partials: UnifiedSearchResult[][] = [];
    const searchPromise = unifiedSearch('coffee', {
      ...defaultOpts,
      signal: controller.signal,
      onPartial: (partial) => partials.push(partial),
    });

    await flush();
    expect(partials.length).toBe(1);

    controller.abort();
    const err = await searchPromise.catch((e: unknown) => e);
    expect(isAbortError(err)).toBe(true);

    await flush();
    expect(partials.length).toBe(1);
  });

  it('emits stages in the documented order and marks the last emission final', async () => {
    (poiService.searchPlacesFts as jest.Mock).mockResolvedValue([makePlace('Local Cafe')]);
    const photon = deferred<PhotonResult[]>();
    const category = deferred<{
      categories: string[];
      pois: OsmPoi[];
      localPrimary: boolean;
    }>();
    (photonGeocoder.searchPhoton as jest.Mock).mockReturnValue(photon.promise);
    (categorySearchService.searchByCategory as jest.Mock).mockImplementation(
      (
        _q: string,
        _s: number,
        _w: number,
        _n: number,
        _e: number,
        _l: number,
        opts?: { localOnly?: boolean },
      ) => (opts?.localOnly ? Promise.resolve(null) : category.promise),
    );

    const stages: Array<{ stage: string; final: boolean; names: string[] }> = [];
    const searchPromise = unifiedSearch('coffee', {
      ...defaultOpts,
      onStage: (results, meta) => {
        stages.push({ stage: meta.stage, final: meta.final, names: results.map((r) => r.name) });
      },
    });

    await flush();
    expect(stages.map((s) => s.stage)).toEqual(['local']);

    // Category resolves before Photon — the category stage must wait so the
    // documented order (photon → category) is preserved.
    category.resolve({
      categories: ['cafe'],
      pois: [
        {
          id: 999,
          lat: 40.748,
          lng: -73.985,
          name: 'Category Cafe',
          type: 'amenity',
          subtype: 'cafe',
          tags: { name: 'Category Cafe' },
        },
      ],
      localPrimary: false,
    });
    await flush();
    expect(stages.map((s) => s.stage)).toEqual(['local']);

    photon.resolve([makePhotonResult('Online Cafe')]);
    await flush();
    // All remaining sources have settled, so the final stage follows
    // immediately after photon and category.
    expect(stages.map((s) => s.stage)).toEqual(['local', 'photon', 'category', 'remaining']);
    expect(stages[1].names).toContain('Online Cafe');
    expect(stages[3].final).toBe(true);

    await searchPromise;
    const last = stages[stages.length - 1];
    expect(last.final).toBe(true);
    expect(last.stage).toBe('remaining');
    expect(last.names).toEqual(
      expect.arrayContaining(['Local Cafe', 'Online Cafe', 'Category Cafe']),
    );
  });

  it('does not let a slow source block the photon stage', async () => {
    (poiService.searchPlacesFts as jest.Mock).mockResolvedValue([makePlace('Local Cafe')]);

    const photon = deferred<PhotonResult[]>();
    (photonGeocoder.searchPhoton as jest.Mock).mockReturnValue(photon.promise);
    // Overpass name search is the slow source.
    const osmName = deferred<OsmPoi[]>();
    (osmFetcher.fetchOsmPoisByName as jest.Mock).mockReturnValue(osmName.promise);

    const stages: string[] = [];
    const searchPromise = unifiedSearch('coffee', {
      ...defaultOpts,
      onStage: (_results, meta) => stages.push(meta.stage),
    });

    await flush();
    photon.resolve([makePhotonResult('Online Cafe')]);
    await flush();

    expect(stages).toContain('photon');
    let settled = false;
    void searchPromise.then(() => {
      settled = true;
    });
    await flush();
    expect(settled).toBe(false);

    osmName.resolve([]);
    await searchPromise;
    expect(stages[stages.length - 1]).toBe('remaining');
  });

  it('emits a place returned by two sources only once', async () => {
    (poiService.searchPlacesFts as jest.Mock).mockResolvedValue([
      makePlace('Corner Cafe', 40.748, -73.985),
    ]);
    (photonGeocoder.searchPhoton as jest.Mock).mockResolvedValue([
      makePhotonResult('Corner Cafe', 40.748, -73.985),
    ]);

    const emissions: UnifiedSearchResult[][] = [];
    const results = await unifiedSearch('coffee', {
      ...defaultOpts,
      onStage: (staged) => emissions.push(staged),
    });

    const cornerCount = results.filter((r) => r.name === 'Corner Cafe').length;
    expect(cornerCount).toBe(1);
    const finalEmission = emissions[emissions.length - 1];
    expect(finalEmission.filter((r) => r.name === 'Corner Cafe')).toHaveLength(1);
  });

  it('skips Overpass and Overture for a category query with sufficient local matches', async () => {
    const localPlaces = Array.from({ length: 8 }, (_, i) =>
      makePlace(`Coffee Shop ${i}`, 40.748 + i * 0.001, -73.985 + i * 0.001),
    );
    (poiService.searchPlacesFts as jest.Mock).mockResolvedValue(localPlaces);
    (regionRepository.getRegionContainingPoint as jest.Mock).mockResolvedValue({
      downloadStatus: 'complete',
    });

    await unifiedSearch('coffee', defaultOpts);

    // Only the local-only category pass runs — the Overpass fallback is gated.
    expect(categorySearchService.searchByCategory).toHaveBeenCalledTimes(1);
    expect(overtureFetcher.fetchOverturePlaces).not.toHaveBeenCalled();
  });

  it('runs all sources for a sparse category query', async () => {
    (poiService.searchPlacesFts as jest.Mock).mockResolvedValue([makePlace('Coffee Shop')]);
    (regionRepository.getRegionContainingPoint as jest.Mock).mockResolvedValue({
      downloadStatus: 'complete',
    });

    await unifiedSearch('coffee', defaultOpts);

    expect(categorySearchService.searchByCategory).toHaveBeenCalledTimes(2);
    expect(overtureFetcher.fetchOverturePlaces).toHaveBeenCalledTimes(1);
  });

  it('skips the Overpass name search for a brand query with sufficient local matches', async () => {
    const localPlaces = Array.from({ length: 8 }, (_, i) =>
      makePlace(`Starbucks ${i}`, 40.748 + i * 0.001, -73.985 + i * 0.001),
    );
    (poiService.searchPlacesFts as jest.Mock).mockResolvedValue(localPlaces);

    await unifiedSearch('starbucks', defaultOpts);

    expect(osmFetcher.fetchOsmPoisByName).not.toHaveBeenCalled();
  });

  it('skips Nominatim when an exact structured local address hit exists', async () => {
    (geocodingService.searchAddress as jest.Mock).mockImplementation(
      (_q: string, _limit: number, _lat: number, _lng: number, opts?: { localOnly?: boolean }) => {
        if (opts?.localOnly) {
          return Promise.resolve([
            {
              entry: {
                id: 1,
                text: '350 Fifth Avenue, New York, NY',
                type: 'address',
                housenumber: '350',
                street: 'Fifth Avenue',
                city: 'New York',
                state: 'NY',
                postcode: null,
                country: 'USA',
                lat: 40.748,
                lng: -73.986,
              },
              rank: 0,
            },
          ]);
        }
        return Promise.resolve([]);
      },
    );

    await unifiedSearch('350 fifth avenue', defaultOpts);

    const calls = (geocodingService.searchAddress as jest.Mock).mock.calls as Array<
      [string, number, number, number, { localOnly?: boolean }?]
    >;
    const networkCalls = calls.filter((call) => !call[4]?.localOnly);
    expect(networkCalls).toHaveLength(0);
  });

  it('emits offline city results in the cities stage', async () => {
    (globalGeocoder.isGeonamesReady as jest.Mock).mockReturnValue(true);
    (globalGeocoder.searchGlobalPlaces as jest.Mock).mockResolvedValue([
      {
        geonameId: 2988507,
        name: 'Paris',
        displayName: 'Paris, FR',
        lat: 48.8534,
        lng: 2.3488,
        population: 2_138_551,
        countryCode: 'FR',
      },
    ]);

    const stages: Array<{ stage: string; names: string[] }> = [];
    const results = await unifiedSearch('paris', {
      ...defaultOpts,
      onStage: (staged, meta) =>
        stages.push({ stage: meta.stage, names: staged.map((r) => r.name) }),
    });

    expect(stages.map((s) => s.stage)).toContain('cities');
    expect(stages.find((s) => s.stage === 'cities')?.names).toContain('Paris');
    expect(results.map((r) => r.name)).toContain('Paris');
  });

  it('degrades without error when the GeoNames database is unavailable', async () => {
    (globalGeocoder.isGeonamesReady as jest.Mock).mockReturnValue(false);

    const results = await unifiedSearch('paris', defaultOpts);

    expect(globalGeocoder.searchGlobalPlaces).not.toHaveBeenCalled();
    expect(Array.isArray(results)).toBe(true);
  });

  it('orders brand branches nearest-first and reports the branch count', async () => {
    const near: Place = {
      ...makePlace('Starbucks', 40.7485, -73.9855),
      uuid: 'near-branch',
      brandName: 'Starbucks',
    };
    const far: Place = {
      ...makePlace('Starbucks', 40.758, -73.975),
      uuid: 'far-branch',
      brandName: 'Starbucks',
      avgRating: 5,
      reviewCount: 5000,
    };
    (poiService.searchPlacesFts as jest.Mock).mockResolvedValue([far, near]);

    const results = await unifiedSearch('starbucks', defaultOpts);
    const branches = results.filter((r) => r.name === 'Starbucks');

    expect(branches).toHaveLength(2);
    expect(branches[0].distanceKm).toBeLessThan(branches[1].distanceKm);
    expect(branches[0].brandBranchCount).toBe(2);
  });
});
