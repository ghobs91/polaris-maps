/**
 * placeThumbnailService tests — in-memory MMKV stub, stubbed fetch/website
 * scraper, so no network is touched.
 */

jest.mock('../../src/services/storage/mmkv', () => {
  const store = new Map<string, string>();
  return {
    storage: {
      getString: (key: string) => store.get(key),
      set: (key: string, value: string) => store.set(key, value),
      delete: (key: string) => store.delete(key),
    },
  };
});

const mockFetchWebsitePhotosResult = jest.fn();
jest.mock('../../src/services/poi/websitePhotosService', () => ({
  fetchWebsitePhotosResult: (...args: unknown[]) => mockFetchWebsitePhotosResult(...args),
  normalizeWebsiteUrl: (raw: string | null | undefined) =>
    raw ? new URL(/^https?:/.test(raw) ? raw : `https://${raw}`).toString() : null,
}));

import {
  clearPlaceThumbnailCache,
  getCachedPlaceThumbnail,
  placeThumbnailSource,
  resolvePlaceThumbnail,
} from '../../src/services/places/placeThumbnailService';

const QID = 'Q37158';

function wikidataResponse(filename: string | null) {
  return {
    ok: true,
    json: async () => ({
      entities: {
        [QID]: {
          claims: filename ? { P18: [{ mainsnak: { datavalue: { value: filename } } }] } : {},
        },
      },
    }),
  };
}

describe('placeThumbnailService', () => {
  beforeEach(() => {
    clearPlaceThumbnailCache();
    mockFetchWebsitePhotosResult.mockReset();
    global.fetch = jest.fn().mockResolvedValue(wikidataResponse('Starbucks store.jpg'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('placeThumbnailSource', () => {
    it('prefers an explicit image tag over every other source', () => {
      expect(
        placeThumbnailSource({
          'polaris:thumbnail': 'https://cdn.example/a.jpg',
          wikidata: QID,
          website: 'https://example.com',
        }),
      ).toEqual({
        key: 'url:https://cdn.example/a.jpg',
        source: 'url',
        value: 'https://cdn.example/a.jpg',
      });
    });

    it('falls back to the brand Wikidata entity', () => {
      expect(
        placeThumbnailSource({ 'brand:wikidata': QID, website: 'https://example.com' }),
      ).toEqual({
        key: `wd:${QID}`,
        source: 'wikidata',
        value: QID,
      });
    });

    it('uses the venue website when there is no Wikidata entity', () => {
      expect(placeThumbnailSource({ website: 'https://cafe.example' })?.source).toBe('website');
    });

    it('returns null when a place has nothing to resolve from', () => {
      expect(placeThumbnailSource({ amenity: 'cafe' })).toBeNull();
    });

    it('ignores non-http image values', () => {
      expect(placeThumbnailSource({ image: 'File:Cafe.jpg' })).toBeNull();
    });
  });

  it('resolves a Wikidata P18 photo into a small Commons thumbnail', async () => {
    const url = await resolvePlaceThumbnail({ wikidata: QID });

    expect(url).toContain('commons.wikimedia.org/wiki/Special:FilePath/');
    expect(url).toContain('width=240');
    expect(getCachedPlaceThumbnail({ wikidata: QID })).toBe(url);
  });

  it('serves repeat lookups from cache without another request', async () => {
    await resolvePlaceThumbnail({ wikidata: QID });
    await resolvePlaceThumbnail({ wikidata: QID });

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('shares one in-flight request between rows for the same place', async () => {
    let releaseFetch: (value: unknown) => void = () => {};
    const pending = new Promise((resolve) => {
      releaseFetch = resolve;
    });
    global.fetch = jest.fn(() => pending);

    const a = resolvePlaceThumbnail({ wikidata: QID });
    const b = resolvePlaceThumbnail({ wikidata: QID });
    releaseFetch(wikidataResponse('Starbucks store.jpg'));

    const [first, second] = await Promise.all([a, b]);
    expect(first).toContain('commons.wikimedia.org');
    expect(second).toBe(first);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('negative-caches a place with no photo so it is not re-requested', async () => {
    global.fetch = jest.fn().mockResolvedValue(wikidataResponse(null));

    await expect(resolvePlaceThumbnail({ wikidata: QID })).resolves.toBeNull();
    await expect(resolvePlaceThumbnail({ wikidata: QID })).resolves.toBeNull();

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('uses the website scraper when there is no Wikidata entity', async () => {
    mockFetchWebsitePhotosResult.mockResolvedValue({
      urls: ['https://cafe.example/photo.jpg'],
      ok: true,
      finalUrl: null,
    });

    await expect(resolvePlaceThumbnail({ website: 'https://cafe.example' })).resolves.toBe(
      'https://cafe.example/photo.jpg',
    );
    expect(mockFetchWebsitePhotosResult).toHaveBeenCalledWith('https://cafe.example/');
  });

  it('never fetches for a place with no photo source', async () => {
    await expect(resolvePlaceThumbnail({ amenity: 'cafe' })).resolves.toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockFetchWebsitePhotosResult).not.toHaveBeenCalled();
  });
});
