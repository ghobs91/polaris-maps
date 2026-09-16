/**
 * Search quality evaluation.
 *
 * Runs a fixed corpus of realistic queries through the real `unifiedSearch`
 * pipeline with network sources mocked and the real ranker active. Asserts
 * mean recall@3 and NDCG@3 against thresholds pinned to current behavior, so
 * ranking changes cannot silently regress expected results.
 */

// Mock native/expo modules required by transitive imports
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
import * as poiService from '../../src/services/poi/poiService';
import * as categorySearchService from '../../src/services/poi/categorySearchService';
import * as photonGeocoder from '../../src/services/search/photonGeocoder';
import * as geocodingService from '../../src/services/geocoding/geocodingService';
import * as overtureFetcher from '../../src/services/poi/overtureFetcher';
import * as osmFetcher from '../../src/services/poi/osmFetcher';
import type { Place } from '../../src/models/poi';
import type { GeocodingResult } from '../../src/services/geocoding/geocodingService';
import type { PhotonResult } from '../../src/services/search/photonGeocoder';

// ---------------------------------------------------------------------------
// Corpus
// ---------------------------------------------------------------------------

interface CorpusPlace {
  name: string;
  category: Place['category'];
  lat: number;
  lng: number;
  brandName?: string;
  addressCity?: string;
  reviewCount?: number;
  avgRating?: number;
}

const NY = { lat: 40.748, lng: -73.985 };

const PLACES: CorpusPlace[] = [
  {
    name: 'Starbucks',
    category: 'cafe',
    lat: 40.748,
    lng: -73.985,
    brandName: 'Starbucks',
    reviewCount: 1500,
    avgRating: 4.1,
  },
  {
    name: 'Starbucks',
    category: 'cafe',
    lat: 40.758,
    lng: -73.975,
    brandName: 'Starbucks',
    reviewCount: 900,
    avgRating: 4.0,
  },
  {
    name: 'Babylon Bean Coffee House',
    category: 'cafe',
    lat: 40.72,
    lng: -73.99,
    reviewCount: 300,
    avgRating: 4.7,
  },
  {
    name: 'Blue Bottle Coffee',
    category: 'cafe',
    lat: 40.742,
    lng: -73.99,
    reviewCount: 500,
    avgRating: 4.5,
  },
  {
    name: 'The Coffee Grind',
    category: 'cafe',
    lat: 40.735,
    lng: -73.995,
    reviewCount: 120,
    avgRating: 4.6,
  },
  {
    name: "Joe's Pizza",
    category: 'restaurant',
    lat: 40.73,
    lng: -74.0,
    reviewCount: 3200,
    avgRating: 4.6,
  },
  {
    name: 'Pizza Palace',
    category: 'restaurant',
    lat: 40.75,
    lng: -73.98,
    reviewCount: 800,
    avgRating: 4.2,
  },
  {
    name: "McDonald's",
    category: 'fast_food',
    lat: 40.74,
    lng: -73.99,
    brandName: "McDonald's",
    reviewCount: 4100,
    avgRating: 3.7,
  },
  {
    name: 'Burger King',
    category: 'fast_food',
    lat: 40.739,
    lng: -73.989,
    brandName: 'Burger King',
    reviewCount: 2200,
    avgRating: 3.6,
  },
  {
    name: 'Taco Bell',
    category: 'fast_food',
    lat: 40.741,
    lng: -73.991,
    brandName: 'Taco Bell',
    reviewCount: 1100,
    avgRating: 3.5,
  },
  {
    name: 'Chipotle Mexican Grill',
    category: 'fast_food',
    lat: 40.755,
    lng: -73.977,
    brandName: 'Chipotle',
    reviewCount: 2600,
    avgRating: 4.0,
  },
  {
    name: 'Panera Bread',
    category: 'cafe',
    lat: 40.753,
    lng: -73.979,
    brandName: 'Panera Bread',
    reviewCount: 1700,
    avgRating: 4.0,
  },
  {
    name: 'Chick-fil-A',
    category: 'fast_food',
    lat: 40.76,
    lng: -73.984,
    brandName: 'Chick-fil-A',
    reviewCount: 3400,
    avgRating: 4.4,
  },
  {
    name: 'Subway',
    category: 'fast_food',
    lat: 40.749,
    lng: -73.984,
    brandName: 'Subway',
    reviewCount: 600,
    avgRating: 3.4,
  },
  {
    name: 'Whole Foods Market',
    category: 'supermarket',
    lat: 40.737,
    lng: -73.99,
    brandName: 'Whole Foods Market',
    reviewCount: 2900,
    avgRating: 4.3,
  },
  {
    name: "Trader Joe's",
    category: 'supermarket',
    lat: 40.732,
    lng: -73.994,
    brandName: "Trader Joe's",
    reviewCount: 2100,
    avgRating: 4.5,
  },
  {
    name: 'Fairway Market',
    category: 'grocery',
    lat: 40.777,
    lng: -73.983,
    reviewCount: 700,
    avgRating: 4.2,
  },
  {
    name: 'CVS Pharmacy',
    category: 'pharmacy',
    lat: 40.746,
    lng: -73.986,
    brandName: 'CVS',
    reviewCount: 400,
    avgRating: 3.2,
  },
  {
    name: 'Walgreens',
    category: 'pharmacy',
    lat: 40.744,
    lng: -73.987,
    brandName: 'Walgreens',
    reviewCount: 350,
    avgRating: 3.1,
  },
  {
    name: 'Duane Reade',
    category: 'pharmacy',
    lat: 40.75,
    lng: -73.986,
    reviewCount: 200,
    avgRating: 3.3,
  },
  {
    name: 'Shell',
    category: 'gas_station',
    lat: 40.743,
    lng: -73.999,
    brandName: 'Shell',
    reviewCount: 120,
    avgRating: 3.8,
  },
  {
    name: 'Exxon',
    category: 'gas_station',
    lat: 40.76,
    lng: -73.99,
    brandName: 'Exxon',
    reviewCount: 90,
    avgRating: 3.7,
  },
  {
    name: 'Planet Fitness',
    category: 'gym',
    lat: 40.734,
    lng: -73.99,
    brandName: 'Planet Fitness',
    reviewCount: 800,
    avgRating: 3.9,
  },
  {
    name: 'Equinox Fitness',
    category: 'gym',
    lat: 40.752,
    lng: -73.973,
    reviewCount: 400,
    avgRating: 4.4,
  },
  {
    name: 'Hilton Garden Inn',
    category: 'hotel',
    lat: 40.752,
    lng: -73.978,
    brandName: 'Hilton',
    reviewCount: 1300,
    avgRating: 4.1,
  },
  {
    name: 'Hotel Chelsea',
    category: 'hotel',
    lat: 40.744,
    lng: -73.997,
    reviewCount: 600,
    avgRating: 4.3,
  },
  {
    name: 'Chase Bank',
    category: 'bank',
    lat: 40.751,
    lng: -73.985,
    brandName: 'Chase',
    reviewCount: 210,
    avgRating: 3.0,
  },
  {
    name: 'Bank of America',
    category: 'bank',
    lat: 40.747,
    lng: -73.983,
    brandName: 'Bank of America',
    reviewCount: 260,
    avgRating: 3.1,
  },
  {
    name: 'Central Park',
    category: 'park',
    lat: 40.782,
    lng: -73.965,
    reviewCount: 25000,
    avgRating: 4.9,
  },
  {
    name: 'Prospect Park',
    category: 'park',
    lat: 40.66,
    lng: -73.97,
    reviewCount: 9000,
    avgRating: 4.7,
  },
  {
    name: 'Brooklyn Bridge',
    category: 'other',
    lat: 40.706,
    lng: -73.996,
    reviewCount: 12000,
    avgRating: 4.8,
  },
  {
    name: 'Times Square',
    category: 'other',
    lat: 40.758,
    lng: -73.985,
    reviewCount: 30000,
    avgRating: 4.6,
  },
  {
    name: 'American Museum of Natural History',
    category: 'museum',
    lat: 40.781,
    lng: -73.974,
    reviewCount: 8000,
    avgRating: 4.8,
  },
  {
    name: 'Metropolitan Museum of Art',
    category: 'museum',
    lat: 40.779,
    lng: -73.963,
    reviewCount: 9500,
    avgRating: 4.8,
  },
  {
    name: 'Grand Central Terminal',
    category: 'train_station',
    lat: 40.752,
    lng: -73.977,
    reviewCount: 7000,
    avgRating: 4.7,
  },
  {
    name: 'Penn Station',
    category: 'train_station',
    lat: 40.751,
    lng: -73.994,
    reviewCount: 5000,
    avgRating: 4.2,
  },
  {
    name: 'LaGuardia Airport',
    category: 'airport',
    lat: 40.776,
    lng: -73.874,
    reviewCount: 4000,
    avgRating: 4.0,
  },
  {
    name: 'JFK International Airport',
    category: 'airport',
    lat: 40.641,
    lng: -73.778,
    reviewCount: 6000,
    avgRating: 4.1,
  },
  {
    name: 'Sushi Yasaka',
    category: 'restaurant',
    lat: 40.78,
    lng: -73.98,
    reviewCount: 400,
    avgRating: 4.7,
  },
  {
    name: "Katz's Delicatessen",
    category: 'deli',
    lat: 40.722,
    lng: -73.987,
    reviewCount: 8000,
    avgRating: 4.6,
  },
  {
    name: 'Peter Luger Steak House',
    category: 'restaurant',
    lat: 40.71,
    lng: -73.96,
    reviewCount: 6000,
    avgRating: 4.5,
  },
  {
    name: "Junior's Restaurant",
    category: 'restaurant',
    lat: 40.703,
    lng: -73.985,
    reviewCount: 5000,
    avgRating: 4.4,
  },
  {
    name: '7-Eleven',
    category: 'convenience',
    lat: 40.745,
    lng: -73.988,
    brandName: '7-Eleven',
    reviewCount: 300,
    avgRating: 3.2,
  },
  {
    name: 'Marshalls',
    category: 'clothing',
    lat: 40.754,
    lng: -73.982,
    brandName: 'Marshalls',
    reviewCount: 500,
    avgRating: 3.9,
  },
];

const ADDRESSES = [
  {
    text: '350 Fifth Avenue, New York, NY 10118',
    lat: 40.7484,
    lng: -73.9857,
    housenumber: '350',
    street: 'Fifth Avenue',
    city: 'New York',
  },
  {
    text: '123 Main Street, Brooklyn, NY 11201',
    lat: 40.702,
    lng: -73.99,
    housenumber: '123',
    street: 'Main Street',
    city: 'Brooklyn',
  },
  {
    text: '1 Times Square, New York, NY 10036',
    lat: 40.756,
    lng: -73.986,
    housenumber: '1',
    street: 'Times Square',
    city: 'New York',
  },
  {
    text: '314 Columbus Avenue, New York, NY 10023',
    lat: 40.777,
    lng: -73.977,
    housenumber: '314',
    street: 'Columbus Avenue',
    city: 'New York',
  },
];

const PHOTON_POIS = [
  { name: 'Woodbury Common Premium Outlets', lat: 41.316, lng: -74.127, city: 'Central Valley' },
  { name: 'Jersey Gardens Outlet Mall', lat: 40.663, lng: -74.171, city: 'Elizabeth' },
];

// ---------------------------------------------------------------------------
// Mock source implementations (deterministic token-prefix matching)
// ---------------------------------------------------------------------------

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9']+/g, ' ')
    .split(' ')
    .filter(Boolean);
}

function tokenPrefixMatch(queryTokens: string[], fieldTokens: string[]): boolean {
  return queryTokens.every((qt) =>
    fieldTokens.some((ft) => ft.startsWith(qt) || qt.startsWith(ft)),
  );
}

function toPlace(row: CorpusPlace, index: number): Place {
  return {
    uuid: `eval-${index}`,
    name: row.name,
    category: row.category,
    lat: row.lat,
    lng: row.lng,
    geohash8: 'dr5regw3',
    addressCity: row.addressCity,
    brandName: row.brandName,
    avgRating: row.avgRating,
    reviewCount: row.reviewCount ?? 0,
    status: 'open',
    source: 'overture',
    authorPubkey: '',
    signature: '',
    createdAt: 1_700_000_000,
    updatedAt: 1_700_000_000,
  };
}

const placeRows = PLACES.map(toPlace);

function installMocks(): void {
  (poiService.searchPlacesFts as jest.Mock).mockImplementation(
    (query: string, south: number, west: number, north: number, east: number) => {
      const qt = tokens(query);
      return Promise.resolve(
        placeRows
          .map((place, i) => ({ place, row: PLACES[i] }))
          .filter(({ place, row }) => {
            if (place.lat < south || place.lat > north) return false;
            if (place.lng < west || place.lng > east) return false;
            const field = tokens(
              `${row.name} ${row.brandName ?? ''} ${row.category} ${row.addressCity ?? ''}`,
            );
            return qt.length > 0 && tokenPrefixMatch(qt, field);
          })
          .map(({ place }) => place),
      );
    },
  );

  (categorySearchService.searchByCategory as jest.Mock).mockResolvedValue(null);

  (geocodingService.searchAddress as jest.Mock).mockImplementation((query: string) => {
    const qt = tokens(query);
    const results: GeocodingResult[] = ADDRESSES.filter((a) =>
      tokenPrefixMatch(qt, tokens(`${a.text} ${a.city} ${a.housenumber} ${a.street}`)),
    ).map((a, i) => ({
      entry: {
        id: 1_000_000 + i,
        text: a.text,
        type: 'address' as const,
        housenumber: a.housenumber,
        street: a.street,
        city: a.city,
        state: 'NY',
        postcode: null,
        country: 'USA',
        lat: a.lat,
        lng: a.lng,
      },
      rank: i,
    }));
    return Promise.resolve(results);
  });

  (photonGeocoder.searchPhoton as jest.Mock).mockImplementation((query: string) => {
    const qt = tokens(query);
    const results: PhotonResult[] = PHOTON_POIS.filter((p) =>
      qt.some((t) => tokens(p.name).some((ft) => ft.startsWith(t) || t.startsWith(ft))),
    ).map((p) => ({
      poi: {
        id: Math.round(p.lat * 1e6),
        lat: p.lat,
        lng: p.lng,
        name: p.name,
        type: 'shop',
        subtype: 'mall',
        tags: { name: p.name, shop: 'mall', 'addr:city': p.city },
      },
      isPoi: true,
      address: { city: p.city },
      displayText: `${p.name}, ${p.city}`,
    }));
    return Promise.resolve(results);
  });

  (overtureFetcher.fetchOverturePlaces as jest.Mock).mockResolvedValue([]);
  (osmFetcher.fetchOsmPoisByName as jest.Mock).mockResolvedValue([]);
}

// ---------------------------------------------------------------------------
// Query expectations
// ---------------------------------------------------------------------------

interface EvalQuery {
  query: string;
  /** Lowercase substrings identifying relevant results (order = ideal order). */
  expected: string[];
}

const QUERIES: EvalQuery[] = [
  { query: 'starbucks', expected: ['starbucks'] },
  { query: 'starbuks', expected: ['starbucks'] },
  { query: 'coffee', expected: ['babylon bean coffee', 'blue bottle coffee', 'the coffee grind'] },
  { query: 'pizza', expected: ["joe's pizza", 'pizza palace'] },
  { query: "joe's pizza", expected: ["joe's pizza"] },
  { query: 'pizza palace', expected: ['pizza palace'] },
  { query: 'mcdonalds', expected: ["mcdonald's"] },
  { query: 'burger king', expected: ['burger king'] },
  { query: 'taco bell', expected: ['taco bell'] },
  { query: 'chipotle', expected: ['chipotle'] },
  { query: 'panera', expected: ['panera'] },
  { query: 'chick-fil-a', expected: ['chick-fil-a'] },
  { query: 'subway', expected: ['subway'] },
  { query: 'whole foods', expected: ['whole foods'] },
  { query: 'trader joes', expected: ["trader joe's"] },
  { query: 'cvs', expected: ['cvs'] },
  { query: 'walgreens', expected: ['walgreens'] },
  { query: 'shell gas', expected: ['shell'] },
  { query: 'chase bank', expected: ['chase bank'] },
  { query: 'bank of america', expected: ['bank of america'] },
  { query: 'planet fitness', expected: ['planet fitness'] },
  { query: 'gym', expected: ['planet fitness', 'equinox fitness'] },
  { query: 'hotel', expected: ['hotel chelsea', 'hilton garden inn'] },
  { query: 'museum', expected: ['american museum', 'metropolitan museum'] },
  { query: 'park', expected: ['central park', 'prospect park'] },
  { query: 'airport', expected: ['laguardia', 'jfk'] },
  { query: 'train station', expected: ['grand central', 'penn station'] },
  { query: 'deli', expected: ["katz's delicatessen"] },
  { query: 'sushi', expected: ['sushi yasaka'] },
  { query: 'peter luger', expected: ['peter luger'] },
  { query: 'brooklyn bridge', expected: ['brooklyn bridge'] },
  { query: 'times square', expected: ['times square'] },
  { query: 'outlets', expected: ['jersey gardens', 'woodbury common'] },
  { query: '350 fifth avenue', expected: ['350 fifth avenue'] },
  { query: '123 main street, brooklyn', expected: ['123 main street'] },
  { query: '314 columbus ave', expected: ['314 columbus avenue'] },
  { query: '1 times square', expected: ['1 times square'] },
];

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

function isRelevant(name: string, expected: string[]): boolean {
  const n = name.toLowerCase();
  return expected.some((e) => n.includes(e.toLowerCase()));
}

function recallAt3(names: string[], expected: string[]): number {
  const top3 = names.slice(0, 3).map((n) => n.toLowerCase());
  const hits = expected.filter((e) => top3.some((n) => n.includes(e.toLowerCase()))).length;
  return hits / Math.min(3, expected.length);
}

function ndcgAt3(names: string[], expected: string[]): number {
  const top3 = names.slice(0, 3);
  const dcg = top3.reduce(
    (sum, name, i) => sum + (isRelevant(name, expected) ? 1 / Math.log2(i + 2) : 0),
    0,
  );
  const idealHits = Math.min(3, expected.length);
  let idcg = 0;
  for (let i = 0; i < idealHits; i++) idcg += 1 / Math.log2(i + 2);
  return idcg === 0 ? 0 : dcg / idcg;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('search quality evaluation', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    installMocks();
  });

  it('meets mean recall@3 and NDCG@3 thresholds across the fixture', async () => {
    const failures: string[] = [];
    let recallSum = 0;
    let ndcgSum = 0;

    for (const { query, expected } of QUERIES) {
      const results = await unifiedSearch(query, { ...NY, zoom: 11, limit: 10 });
      const names = results.map((r) => r.name);
      const recall = recallAt3(names, expected);
      const ndcg = ndcgAt3(names, expected);
      recallSum += recall;
      ndcgSum += ndcg;

      if (recall < 1) {
        failures.push(
          `"${query}" missed: expected one of [${expected.join(', ')}], got [${names
            .slice(0, 3)
            .join(' | ')}]`,
        );
      }
    }

    const meanRecall = recallSum / QUERIES.length;
    const meanNdcg = ndcgSum / QUERIES.length;

    if (failures.length > 0) {
      throw new Error(
        `${failures.length}/${QUERIES.length} queries missed top-3:\n${failures.join('\n')}`,
      );
    }

    expect(QUERIES.length).toBeGreaterThanOrEqual(30);
    expect(meanRecall).toBeGreaterThanOrEqual(0.95);
    expect(meanNdcg).toBeGreaterThanOrEqual(0.9);
  });
});
