/**
 * Bundled coarse geocoder.
 *
 * This is the layer that answers when no region pack covers the point — the
 * cold-install and out-of-coverage states that used to fall through to a
 * network geocoder. It must resolve the common cases from bytes already in the
 * binary, and it must admit when it knows nothing rather than guessing.
 */

jest.mock('expo-sqlite', () => ({}));

import {
  MAX_COARSE_DISTANCE_KM,
  __resetCoarseGeocoderForTests,
  isBundledCityName,
  nearestCoarsePlace,
  searchCoarseCities,
} from '../../src/services/geocoding/coarseGeocoder';

beforeEach(() => {
  __resetCoarseGeocoderForTests();
});

describe('nearestCoarsePlace', () => {
  it('resolves a city, its state and its country', () => {
    const place = nearestCoarsePlace(42.3601, -71.0589);

    expect(place).not.toBeNull();
    expect(place!.country).toBe('United States');
    expect(place!.countryCode).toBe('US');
    expect(place!.admin1).toBe('Massachusetts');
    expect(place!.distanceKm).toBeLessThan(30);
  });

  it('resolves the right country outside the US', () => {
    expect(nearestCoarsePlace(51.5074, -0.1278)?.country).toBe('United Kingdom');
    expect(nearestCoarsePlace(35.6762, 139.6503)?.country).toBe('Japan');
    expect(nearestCoarsePlace(48.8566, 2.3522)?.country).toBe('France');
  });

  it('still answers in sparsely populated areas', () => {
    const place = nearestCoarsePlace(47.0, -109.0); // central Montana

    expect(place).not.toBeNull();
    expect(place!.country).toBe('United States');
    expect(place!.distanceKm).toBeGreaterThan(0);
    expect(place!.distanceKm).toBeLessThanOrEqual(MAX_COARSE_DISTANCE_KM);
  });

  it('refuses to name a city for a point in open ocean', () => {
    // Mid-Atlantic, hundreds of kilometres from the nearest coast.
    expect(nearestCoarsePlace(-30, -30)).toBeNull();
  });

  it('returns the genuinely nearest bundled city, not the first in the file', () => {
    const paris = nearestCoarsePlace(48.8566, 2.3522);
    const lyon = nearestCoarsePlace(45.764, 4.8357);

    expect(paris!.city).not.toBe(lyon!.city);
    expect(paris!.city).toContain('Paris');
    expect(lyon!.city).toContain('Lyon');
  });

  it('loads the dataset once across calls', () => {
    const first = nearestCoarsePlace(42.3601, -71.0589);
    const second = nearestCoarsePlace(42.3601, -71.0589);
    expect(second).toEqual(first);
  });
});

describe('searchCoarseCities', () => {
  it('finds a city by exact name', () => {
    const [paris] = searchCoarseCities('paris');

    expect(paris.name).toBe('Paris');
    expect(paris.countryCode).toBe('FR');
    expect(paris.displayName).toContain('France');
    expect(paris.geonameId).toBeGreaterThan(0);
  });

  it('matches a prefix the way a search field needs', () => {
    const results = searchCoarseCities('bos', undefined, undefined, 25);

    expect(results.some((city) => city.name === 'Boston')).toBe(true);
  });

  it('is case insensitive and ignores surrounding space', () => {
    expect(searchCoarseCities('  TOKYO  ')[0]?.name).toBe('Tokyo');
  });

  it('leads with a major city rather than an obscure exact match', () => {
    // Several places are literally named "San"; a search box should answer with
    // the big cities that start with it, not the smallest exact match.
    const results = searchCoarseCities('san', undefined, undefined, 5);

    expect(results.length).toBeGreaterThan(1);
    expect(results[0]!.population).toBeGreaterThan(1_000_000);
    for (const city of results) {
      expect(city.name.toLowerCase()).toContain('san');
    }
  });

  it('breaks ties between identically named cities by population', () => {
    const results = searchCoarseCities('springfield', undefined, undefined, 5);
    const populations = results.map((city) => city.population);

    expect(results.length).toBeGreaterThan(1);
    for (let i = 1; i < populations.length; i += 1) {
      expect(populations[i]).toBeLessThanOrEqual(populations[i - 1]!);
    }
  });

  it('prefers the city nearer the reference point when names collide', () => {
    const nearBoston = searchCoarseCities('springfield', 42.36, -71.06)[0];
    const nearChicago = searchCoarseCities('springfield', 41.88, -87.63)[0];

    expect(nearBoston.name).toBe('Springfield');
    expect(nearBoston.countryCode).toBe('US');
    expect(nearChicago.geonameId).not.toBe(nearBoston.geonameId);
  });

  it('respects the limit and returns nothing for a miss', () => {
    expect(searchCoarseCities('a', undefined, undefined, 3)).toHaveLength(0);
    expect(searchCoarseCities('paris', undefined, undefined, 2).length).toBeLessThanOrEqual(2);
    expect(searchCoarseCities('zzzzqqq')).toEqual([]);
  });
});

describe('isBundledCityName', () => {
  it('recognises an exact bundled city', () => {
    expect(isBundledCityName('boston')).toBe(true);
    expect(isBundledCityName('  Boston ')).toBe(true);
  });

  it('rejects near misses and short tokens', () => {
    expect(isBundledCityName('bostonn')).toBe(false);
    expect(isBundledCityName('bo')).toBe(false);
    expect(isBundledCityName('notacityatall')).toBe(false);
  });
});
