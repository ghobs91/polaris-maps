import {
  enrichPoi,
  clearEnrichmentCache,
  fetchWikidataLogo,
  commonsThumbUrl,
  formatOpeningHours,
} from '../../src/services/poi/poiEnricher';
import type { OsmPoi } from '../../src/services/poi/osmFetcher';

const mockSearchPOI = jest.fn();
jest.mock('../../src/native/mapkit', () => ({
  searchPOI: (...args: unknown[]) => mockSearchPOI(...args),
}));

// Mock global fetch for Wikidata API calls
const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

/** Build a mock wbgetentities response for a given QID and claims */
function wbgetentities(qid: string, claims: Record<string, unknown[]>) {
  return {
    ok: true,
    json: async () => ({ entities: { [qid]: { claims } } }),
  };
}

beforeEach(() => {
  clearEnrichmentCache();
  mockSearchPOI.mockReset();
  mockFetch.mockReset();
  // Default: no Wikidata response (logo fetching returns nothing)
  mockFetch.mockResolvedValue({ ok: false });
});

const basePoi: OsmPoi = {
  id: 12345,
  lat: 40.7128,
  lng: -74.006,
  name: 'Test Cafe',
  type: 'amenity',
  subtype: 'cafe',
  tags: { name: 'Test Cafe', amenity: 'cafe' },
};

describe('enrichPoi', () => {
  it('fills phone, website, address, and category from native MapKit', async () => {
    mockSearchPOI.mockResolvedValueOnce({
      name: 'Test Cafe',
      phoneNumber: '+1 (212) 555-1234',
      url: 'https://testcafe.com',
      latitude: 40.7128,
      longitude: -74.006,
      pointOfInterestCategory: 'MKPOICategoryCafe',
      formattedAddress: '123 Main St\nNew York NY 10001',
      timeZone: 'America/New_York',
    });

    const result = await enrichPoi(basePoi);
    expect(result.phone).toBe('+1 (212) 555-1234');
    expect(result.website).toBe('https://testcafe.com');
    expect(result.formattedAddress).toBe('123 Main St, New York NY 10001');
    expect(result.poiCategory).toBe('MKPOICategoryCafe');
    expect(result.timeZone).toBe('America/New_York');
  });

  it('does not overwrite existing OSM phone/website/address tags', async () => {
    const poiWithData: OsmPoi = {
      ...basePoi,
      tags: {
        ...basePoi.tags,
        phone: '+1 (555) 000-0000',
        website: 'https://osm-cafe.com',
        'addr:street': 'Broadway',
      },
    };

    mockSearchPOI.mockResolvedValueOnce({
      name: 'Test Cafe',
      phoneNumber: '+1 (212) 555-1234',
      url: 'https://testcafe.com',
      latitude: 40.7128,
      longitude: -74.006,
      formattedAddress: '123 Apple Way\nCupertino CA 95014',
    });

    const result = await enrichPoi(poiWithData);
    expect(result.phone).toBeUndefined();
    expect(result.website).toBeUndefined();
    expect(result.formattedAddress).toBeUndefined();
  });

  it('returns empty object when no native match and no wikidata tag', async () => {
    mockSearchPOI.mockResolvedValueOnce(null);

    const result = await enrichPoi(basePoi);
    expect(result).toEqual({});
  });

  it('fetches logo from Wikidata when brand:wikidata tag present', async () => {
    mockSearchPOI.mockResolvedValueOnce(null);
    mockFetch.mockResolvedValueOnce(
      wbgetentities('Q37158', {
        P154: [{ mainsnak: { datavalue: { value: 'Starbucks Logo.svg', type: 'string' } } }],
      }),
    );

    const poiWithWikidata: OsmPoi = {
      ...basePoi,
      tags: { ...basePoi.tags, 'brand:wikidata': 'Q37158' },
    };
    const result = await enrichPoi(poiWithWikidata);
    expect(result.logoUrl).toBe(
      'https://commons.wikimedia.org/wiki/Special:FilePath/Starbucks_Logo.svg?width=256',
    );
  });

  it('falls back to P18 (image) when P154 (logo) is absent', async () => {
    mockSearchPOI.mockResolvedValueOnce(null);
    // P154 absent, P18 has image
    mockFetch.mockResolvedValueOnce(
      wbgetentities('Q1185675', {
        P18: [{ mainsnak: { datavalue: { value: 'IHOP Restaurant.jpg', type: 'string' } } }],
      }),
    );

    const poiWithWikidata: OsmPoi = {
      ...basePoi,
      tags: { ...basePoi.tags, wikidata: 'Q1185675' },
    };
    const result = await enrichPoi(poiWithWikidata);
    expect(result.logoUrl).toContain('IHOP_Restaurant.jpg');
  });

  it('caches results and does not re-fetch for same POI', async () => {
    mockSearchPOI.mockResolvedValueOnce({
      name: 'Test Cafe',
      latitude: 40.7128,
      longitude: -74.006,
      pointOfInterestCategory: 'MKPOICategoryCafe',
    });

    await enrichPoi(basePoi);
    await enrichPoi(basePoi);

    expect(mockSearchPOI).toHaveBeenCalledTimes(1);
  });

  it('caches partial results (no match, no wikidata) and does not re-fetch', async () => {
    mockSearchPOI.mockResolvedValueOnce(null);

    const r1 = await enrichPoi(basePoi);
    const r2 = await enrichPoi(basePoi);

    expect(r1).toEqual({});
    expect(r2).toEqual({});
    expect(mockSearchPOI).toHaveBeenCalledTimes(1);
  });

  it('fills only missing fields — partial enrichment', async () => {
    const poiWithPhone: OsmPoi = {
      ...basePoi,
      tags: { ...basePoi.tags, 'contact:phone': '+1 (555) 999-9999' },
    };

    mockSearchPOI.mockResolvedValueOnce({
      name: 'Test Cafe',
      phoneNumber: '+1 (212) 555-1234',
      url: 'https://testcafe.com',
      latitude: 40.7128,
      longitude: -74.006,
    });

    const result = await enrichPoi(poiWithPhone);
    expect(result.phone).toBeUndefined();
    expect(result.website).toBe('https://testcafe.com');
  });

  it('includes logo from Wikidata when MapKit also matches', async () => {
    mockSearchPOI.mockResolvedValueOnce({
      name: 'Best Buy',
      url: 'https://stores.bestbuy.com/ny/levittown/123.html',
      latitude: 40.7128,
      longitude: -74.006,
    });
    mockFetch.mockResolvedValueOnce(
      wbgetentities('Q533415', {
        P154: [{ mainsnak: { datavalue: { value: 'Best Buy Logo.svg', type: 'string' } } }],
      }),
    );

    const result = await enrichPoi({
      ...basePoi,
      name: 'Best Buy',
      tags: { name: 'Best Buy', shop: 'electronics', 'brand:wikidata': 'Q533415' },
    });
    expect(result.logoUrl).toContain('Best_Buy_Logo.svg');
    expect(result.website).toBe('https://stores.bestbuy.com/ny/levittown/123.html');
  });

  it('enriches opening hours from MapKit when OSM has none', async () => {
    mockSearchPOI.mockResolvedValueOnce({
      name: 'Test Cafe',
      latitude: 40.7128,
      longitude: -74.006,
      openingHoursPeriods: [
        { openDay: '2', openTime: '09:00', closeDay: '2', closeTime: '17:00' },
        { openDay: '3', openTime: '09:00', closeDay: '3', closeTime: '17:00' },
      ],
    });

    const result = await enrichPoi(basePoi);
    expect(result.openingHours).toBe('Tue 09:00–17:00, Wed 09:00–17:00');
  });

  it('does not overwrite OSM opening_hours with MapKit hours', async () => {
    mockSearchPOI.mockResolvedValueOnce({
      name: 'Test Cafe',
      latitude: 40.7128,
      longitude: -74.006,
      openingHoursPeriods: [{ openDay: '1', openTime: '08:00', closeDay: '1', closeTime: '20:00' }],
    });

    const poiWithHours: OsmPoi = {
      ...basePoi,
      tags: { ...basePoi.tags, opening_hours: 'Mo-Fr 09:00-18:00' },
    };
    const result = await enrichPoi(poiWithHours);
    expect(result.openingHours).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// fetchWikidataLogo
// ---------------------------------------------------------------------------

describe('fetchWikidataLogo', () => {
  it('fetches logo from brand:wikidata QID', async () => {
    mockFetch.mockResolvedValueOnce(
      wbgetentities('Q37158', {
        P154: [{ mainsnak: { datavalue: { value: 'Starbucks Logo.svg', type: 'string' } } }],
      }),
    );

    const url = await fetchWikidataLogo({ 'brand:wikidata': 'Q37158' });
    expect(url).toBe(
      'https://commons.wikimedia.org/wiki/Special:FilePath/Starbucks_Logo.svg?width=256',
    );
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('ids=Q37158'),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('uses operator:wikidata as fallback', async () => {
    mockFetch.mockResolvedValueOnce(
      wbgetentities('Q668687', {
        P154: [{ mainsnak: { datavalue: { value: 'USPS Logo.svg', type: 'string' } } }],
      }),
    );

    const url = await fetchWikidataLogo({ 'operator:wikidata': 'Q668687' });
    expect(url).toContain('USPS_Logo.svg');
  });

  it('uses wikidata tag as last resort', async () => {
    mockFetch.mockResolvedValueOnce(
      wbgetentities('Q12345', {
        P154: [{ mainsnak: { datavalue: { value: 'Logo.png', type: 'string' } } }],
      }),
    );

    const url = await fetchWikidataLogo({ wikidata: 'Q12345' });
    expect(url).toContain('Logo.png');
  });

  it('returns undefined when no QID tag present', async () => {
    const url = await fetchWikidataLogo({ name: 'Some Place' });
    expect(url).toBeUndefined();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns undefined for invalid QID format', async () => {
    const url = await fetchWikidataLogo({ 'brand:wikidata': 'not-a-qid' });
    expect(url).toBeUndefined();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns undefined when Wikidata API fails', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false });

    const url = await fetchWikidataLogo({ 'brand:wikidata': 'Q37158' });
    expect(url).toBeUndefined();
  });

  it('caches QID results and reuses on second call', async () => {
    mockFetch.mockResolvedValueOnce(
      wbgetentities('Q37158', {
        P154: [{ mainsnak: { datavalue: { value: 'Logo.svg', type: 'string' } } }],
      }),
    );

    const url1 = await fetchWikidataLogo({ 'brand:wikidata': 'Q37158' });
    const url2 = await fetchWikidataLogo({ 'brand:wikidata': 'Q37158' });
    expect(url1).toBe(url2);
    // Only one fetch — second call used cache
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// commonsThumbUrl
// ---------------------------------------------------------------------------

describe('commonsThumbUrl', () => {
  it('converts filename to Special:FilePath URL with width', () => {
    expect(commonsThumbUrl('Starbucks Logo.svg', 256)).toBe(
      'https://commons.wikimedia.org/wiki/Special:FilePath/Starbucks_Logo.svg?width=256',
    );
  });

  it('encodes special characters', () => {
    expect(commonsThumbUrl("McDonald's Golden Arches.svg", 128)).toBe(
      "https://commons.wikimedia.org/wiki/Special:FilePath/McDonald's_Golden_Arches.svg?width=128",
    );
  });
});

// ---------------------------------------------------------------------------
// formatOpeningHours
// ---------------------------------------------------------------------------

describe('formatOpeningHours', () => {
  it('formats a single period', () => {
    expect(
      formatOpeningHours([{ openDay: '1', openTime: '09:00', closeDay: '1', closeTime: '21:00' }]),
    ).toBe('Mon 09:00–21:00');
  });

  it('formats multiple periods', () => {
    expect(
      formatOpeningHours([
        { openDay: '1', openTime: '09:00', closeDay: '1', closeTime: '21:00' },
        { openDay: '7', openTime: '10:00', closeDay: '7', closeTime: '18:00' },
      ]),
    ).toBe('Mon 09:00–21:00, Sun 10:00–18:00');
  });

  it('handles missing close time', () => {
    expect(formatOpeningHours([{ openDay: '5', openTime: '06:00' }])).toBe('Fri 06:00+');
  });

  it('returns empty string for empty input', () => {
    expect(formatOpeningHours([])).toBe('');
  });
});
