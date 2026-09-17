import {
  collectPlaceMedia,
  mergePlaceMedia,
  normalizePanoramaxResponse,
  normalizeWikimediaResponse,
  type PlaceMediaItem,
  type PlaceMediaProvider,
} from '../../src/services/poi/placeMediaService';

function item(url: string, source: PlaceMediaItem['source'] = 'website'): PlaceMediaItem {
  return { url, source };
}

describe('mergePlaceMedia', () => {
  it('keeps website media primary and dedupes by url', () => {
    const merged = mergePlaceMedia(
      [item('https://site/a.jpg')],
      [item('https://site/a.jpg', 'wikimedia'), item('https://commons/b.jpg', 'wikimedia')],
    );
    expect(merged).toHaveLength(2);
    expect(merged[0].source).toBe('website');
  });

  it('drops empty urls', () => {
    expect(mergePlaceMedia([item('')], [])).toEqual([]);
  });
});

describe('normalizeWikimediaResponse', () => {
  it('extracts url, license, and attribution', () => {
    const items = normalizeWikimediaResponse({
      query: {
        pages: {
          '1': {
            title: 'File:Cafe.jpg',
            imageinfo: [
              {
                thumburl: 'https://upload.wikimedia.org/thumb/cafe.jpg',
                url: 'https://upload.wikimedia.org/cafe.jpg',
                descriptionurl: 'https://commons.wikimedia.org/wiki/File:Cafe.jpg',
                extmetadata: {
                  LicenseShortName: { value: 'CC BY-SA 4.0' },
                  Artist: { value: '<a href="#">Jane Doe</a>' },
                },
              },
            ],
          },
        },
      },
    });

    expect(items).toHaveLength(1);
    expect(items[0].url).toContain('thumb/cafe.jpg');
    expect(items[0].license).toBe('CC BY-SA 4.0');
    expect(items[0].author).toBe('Jane Doe');
    expect(items[0].attribution).toContain('Wikimedia');
  });

  it('returns nothing for an empty/unusable payload', () => {
    expect(normalizeWikimediaResponse(null)).toEqual([]);
    expect(normalizeWikimediaResponse({ query: { pages: {} } })).toEqual([]);
  });
});

describe('normalizePanoramaxResponse', () => {
  it('extracts hd/thumb urls and attribution', () => {
    const items = normalizePanoramaxResponse({
      features: [
        {
          assets: {
            hd: { href: 'https://panoramax.fr/hd/1.jpg' },
            thumb: { href: 'https://panoramax.fr/thumb/1.jpg' },
          },
          properties: { license: 'CC-BY-SA-4.0', author: 'Panoramax' },
        },
      ],
    });
    expect(items).toHaveLength(1);
    expect(items[0].url).toContain('/hd/1.jpg');
    expect(items[0].thumbnailUrl).toContain('/thumb/1.jpg');
    expect(items[0].attribution).toContain('Panoramax');
  });

  it('returns nothing when features are missing', () => {
    expect(normalizePanoramaxResponse({})).toEqual([]);
  });
});

describe('collectPlaceMedia', () => {
  const query = { lat: 1, lng: 2, tags: {} };

  it('merges website primary with supplements', async () => {
    const website: PlaceMediaProvider = {
      id: 'website',
      fetch: async () => [item('https://site/a.jpg')],
    };
    const commons: PlaceMediaProvider = {
      id: 'wikimedia',
      fetch: async () => [item('https://commons/b.jpg', 'wikimedia')],
    };

    const media = await collectPlaceMedia(query, {
      websiteProvider: website,
      supplements: [commons],
    });
    expect(media.map((m) => m.source)).toEqual(['website', 'wikimedia']);
  });

  it('is resilient to a failing provider', async () => {
    const failing: PlaceMediaProvider = {
      id: 'panoramax',
      fetch: async () => {
        throw new Error('down');
      },
    };
    const media = await collectPlaceMedia(query, { supplements: [failing] });
    expect(media).toEqual([]);
  });
});
