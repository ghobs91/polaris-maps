import {
  commonsFilePageUrl,
  createPanoramaxProvider,
  createWikidataCommonsProvider,
} from '../../src/services/poi/placeMediaProviders';

function jsonResponse(payload: unknown): Response {
  return {
    ok: true,
    json: async () => payload,
  } as unknown as Response;
}

const baseQuery = { lat: 48.8584, lng: 2.2945, name: 'Eiffel Tower', tags: {} };

describe('createWikidataCommonsProvider', () => {
  it('returns P18/P154 Commons media with attribution and a license link', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      jsonResponse({
        entities: {
          Q243: {
            claims: {
              P18: [{ mainsnak: { datavalue: { value: 'Tour Eiffel.jpg' } } }],
              P154: [{ mainsnak: { datavalue: { value: 'Eiffel Tower logo.svg' } } }],
            },
          },
        },
      }),
    ) as unknown as typeof fetch;

    const items = await createWikidataCommonsProvider(fetchImpl).fetch({
      ...baseQuery,
      tags: { wikidata: 'Q243' },
    });

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      source: 'wikimedia',
      attribution: 'Wikimedia Commons',
      licenseUrl: commonsFilePageUrl('Tour Eiffel.jpg'),
    });
    expect(items[0].thumbnailUrl).toContain('width=320');
    expect(String((fetchImpl as jest.Mock).mock.calls[0][0])).toContain('ids=Q243');
  });

  it('skips the network when no Wikidata QID is present', async () => {
    const fetchImpl = jest.fn() as unknown as typeof fetch;
    const items = await createWikidataCommonsProvider(fetchImpl).fetch(baseQuery);

    expect(items).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('degrades to no media when the request fails', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch;
    const items = await createWikidataCommonsProvider(fetchImpl).fetch({
      ...baseQuery,
      tags: { wikidata: 'Q243' },
    });

    expect(items).toEqual([]);
  });
});

describe('createPanoramaxProvider', () => {
  it('normalizes nearby Panoramax features with attribution', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      jsonResponse({
        features: [
          {
            assets: { hd: { href: 'https://panoramax.fr/hd/1.jpg' }, thumb: { href: 'th/1.jpg' } },
            properties: { license: 'CC-BY-SA-4.0', author: 'Alice' },
          },
        ],
      }),
    ) as unknown as typeof fetch;

    const items = await createPanoramaxProvider(fetchImpl).fetch(baseQuery);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      url: 'https://panoramax.fr/hd/1.jpg',
      thumbnailUrl: 'th/1.jpg',
      source: 'panoramax',
      author: 'Alice',
      license: 'CC-BY-SA-4.0',
      attribution: 'Panoramax (CC-BY-SA)',
    });
    expect(String((fetchImpl as jest.Mock).mock.calls[0][0])).toContain('bbox=');
  });

  it('returns nothing when the payload is malformed', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({})) as unknown as typeof fetch;
    expect(await createPanoramaxProvider(fetchImpl).fetch(baseQuery)).toEqual([]);
  });
});
