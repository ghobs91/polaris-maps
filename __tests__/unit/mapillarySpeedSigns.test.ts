jest.mock('../../src/constants/config', () => ({
  MAPILLARY_TOKEN: '',
}));

import {
  MAX_BBOX_SPAN_DEG,
  SpeedLimitSignCache,
  bboxAround,
  bboxSpanDeg,
  buildSpeedSignsUrl,
  countryCodeFromRegionId,
  fetchSpeedLimitSigns,
  findNearestSpeedLimitMph,
  isMapillarySpeedSignsConfigured,
  normalizeSpeedLimitSigns,
  parseMaxspeedSignValue,
  signLimitToMph,
  speedUnitForCountry,
  type SpeedLimitSign,
} from '../../src/services/speedLimits/mapillarySpeedSigns';

const mockFetch = jest.fn();
const mockConfig = jest.requireMock('../../src/constants/config') as { MAPILLARY_TOKEN: string };

beforeEach(() => {
  jest.clearAllMocks();
  mockConfig.MAPILLARY_TOKEN = '';
  global.fetch = mockFetch as unknown as typeof fetch;
});

function jsonResponse(payload: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => payload,
  } as Response;
}

function feature(overrides: Record<string, unknown> = {}) {
  return {
    id: '123',
    object_value: 'regulatory--maximum-speed-limit-50--g1',
    geometry: { type: 'Point', coordinates: [13.405, 52.52] },
    last_seen_at: '2025-04-01T10:00:00+0000',
    ...overrides,
  };
}

describe('parseMaxspeedSignValue', () => {
  it('reads the posted number from a maximum-speed-limit sign', () => {
    expect(parseMaxspeedSignValue('regulatory--maximum-speed-limit-50--g1')).toBe(50);
    expect(parseMaxspeedSignValue('regulatory--maximum-speed-limit-5--g2')).toBe(5);
    expect(parseMaxspeedSignValue('regulatory--maximum-speed-limit-130--g1')).toBe(130);
  });

  it('accepts a value without the facing suffix', () => {
    expect(parseMaxspeedSignValue('regulatory--maximum-speed-limit-30')).toBe(30);
  });

  it('rejects advisory plates and minimum-speed signs', () => {
    // Yellow "suggested" plates are guidance, not a citation-grade limit.
    expect(parseMaxspeedSignValue('complementary--maximum-speed-limit-50--g1')).toBeNull();
    expect(parseMaxspeedSignValue('regulatory--minimum-speed-limit-30--g1')).toBeNull();
  });

  it('rejects other traffic signs and malformed values', () => {
    expect(parseMaxspeedSignValue('regulatory--stop--g1')).toBeNull();
    expect(parseMaxspeedSignValue('warning--curve-left--g1')).toBeNull();
    expect(parseMaxspeedSignValue('regulatory--maximum-speed-limit-abc--g1')).toBeNull();
    expect(parseMaxspeedSignValue('regulatory--maximum-speed-limit-0--g1')).toBeNull();
    expect(parseMaxspeedSignValue('regulatory--maximum-speed-limit-9999--g1')).toBeNull();
    expect(parseMaxspeedSignValue(undefined)).toBeNull();
    expect(parseMaxspeedSignValue(null)).toBeNull();
  });
});

describe('speed units', () => {
  it('treats the US and UK as mph, everywhere else as metric', () => {
    expect(speedUnitForCountry('US')).toBe('mph');
    expect(speedUnitForCountry('gb')).toBe('mph');
    expect(speedUnitForCountry('DE')).toBe('km/h');
    expect(speedUnitForCountry('FR')).toBe('km/h');
    expect(speedUnitForCountry(null)).toBe('km/h');
  });

  it('derives the country from an app region id', () => {
    expect(countryCodeFromRegionId('us-ny-new-york')).toBe('US');
    expect(countryCodeFromRegionId('gb-england-london')).toBe('GB');
    expect(countryCodeFromRegionId('de-berlin')).toBe('DE');
    expect(countryCodeFromRegionId('berlin')).toBeNull();
    expect(countryCodeFromRegionId(null)).toBeNull();
  });

  it('converts metric limits to mph', () => {
    expect(signLimitToMph(50, 'km/h')).toBeCloseTo(31.07, 2);
    expect(signLimitToMph(50, 'mph')).toBe(50);
  });
});

describe('normalizeSpeedLimitSigns', () => {
  it('normalizes to mph using the country convention', () => {
    const [sign] = normalizeSpeedLimitSigns({ data: [feature()] }, 'km/h');
    expect(sign).toMatchObject({ id: 'mapillary:123', lat: 52.52, lng: 13.405 });
    expect(sign.limitMph).toBeCloseTo(31.07, 2);
    expect(sign.seenAt).toBe(Date.parse('2025-04-01T10:00:00+0000'));
  });

  it('keeps mph limits as-is in mph countries', () => {
    const [sign] = normalizeSpeedLimitSigns(
      { data: [feature({ object_value: 'regulatory--maximum-speed-limit-65--g1' })] },
      'mph',
    );
    expect(sign.limitMph).toBe(65);
  });

  it('skips signs it cannot place or interpret', () => {
    const signs = normalizeSpeedLimitSigns(
      {
        data: [
          feature({ id: 'no-geometry', geometry: undefined }),
          feature({ id: 'not-a-limit', object_value: 'regulatory--stop--g1' }),
          feature({ id: 'ok' }),
        ],
      },
      'km/h',
    );
    expect(signs.map((s) => s.id)).toEqual(['mapillary:ok']);
  });

  it('returns nothing for malformed payloads', () => {
    expect(normalizeSpeedLimitSigns({}, 'km/h')).toEqual([]);
    expect(normalizeSpeedLimitSigns(null, 'km/h')).toEqual([]);
  });
});

describe('bbox and URL building', () => {
  it('builds a box under the API span limit', () => {
    const box = bboxAround(13.405, 52.52, 0.008);
    expect(bboxSpanDeg(box)).toBeCloseTo(0.008, 6);
    expect(bboxSpanDeg(box)).toBeLessThan(MAX_BBOX_SPAN_DEG);
  });

  it('encodes the token and the west,south,east,north order', () => {
    const url = buildSpeedSignsUrl(
      { west: 13.4, south: 52.5, east: 13.41, north: 52.51 },
      'tok en/+',
    );
    expect(url).toContain('https://graph.mapillary.com/map_features?');
    expect(url).toContain('access_token=tok%20en%2F%2B');
    expect(url).toContain('object_types=traffic_sign');
    expect(url).toContain('bbox=13.4,52.5,13.41,52.51');
  });
});

describe('fetchSpeedLimitSigns', () => {
  it('stays offline without a token', async () => {
    expect(isMapillarySpeedSignsConfigured('')).toBe(false);
    expect(await fetchSpeedLimitSigns(bboxAround(13.4, 52.5, 0.008), 'km/h', '')).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('refuses an oversized box instead of letting the API reject it', async () => {
    const huge = { west: 13, south: 52, east: 14, north: 53 };
    expect(await fetchSpeedLimitSigns(huge, 'km/h', 'token')).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns signs and stays quiet on transport failure', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: [feature()] }));
    const signs = await fetchSpeedLimitSigns(bboxAround(13.405, 52.52, 0.008), 'km/h', 'token');
    expect(signs).toHaveLength(1);

    mockFetch.mockRejectedValueOnce(new Error('offline'));
    expect(await fetchSpeedLimitSigns(bboxAround(13.405, 52.52, 0.008), 'km/h', 'token')).toEqual(
      [],
    );

    mockFetch.mockResolvedValueOnce(jsonResponse({}, false));
    expect(await fetchSpeedLimitSigns(bboxAround(13.405, 52.52, 0.008), 'km/h', 'token')).toEqual(
      [],
    );
  });
});

describe('findNearestSpeedLimitMph', () => {
  const sign = (lng: number, lat: number, limitMph: number): SpeedLimitSign => ({
    id: `s-${lng}-${lat}`,
    lng,
    lat,
    limitMph,
  });

  it('matches a sign on the same stretch of road', () => {
    const signs = [sign(13.405, 52.52, 31)];
    expect(findNearestSpeedLimitMph(signs, 13.405, 52.52001)).toBe(31);
  });

  it('ignores signs beyond the match radius', () => {
    // ~200 m away: a parallel street, not this one.
    expect(findNearestSpeedLimitMph([sign(13.4075, 52.52, 31)], 13.405, 52.52)).toBeNull();
  });

  it('picks the nearest of several signs', () => {
    const signs = [sign(13.4051, 52.52, 31), sign(13.40502, 52.52, 19)];
    expect(findNearestSpeedLimitMph(signs, 13.405, 52.52)).toBe(19);
  });

  it('returns null with an empty cache', () => {
    expect(findNearestSpeedLimitMph([], 13.405, 52.52)).toBeNull();
  });
});

describe('SpeedLimitSignCache', () => {
  const near = (lng: number, lat: number, limitMph: number): SpeedLimitSign => ({
    id: `s-${lng}-${lat}`,
    lng,
    lat,
    limitMph,
  });

  it('serves a fetched limit without repeating the request', async () => {
    const fetchSigns = jest.fn().mockResolvedValue([near(13.405, 52.52, 31)]);
    const cache = new SpeedLimitSignCache({ fetchSigns });

    await cache.refresh(13.405, 52.52, 'km/h');
    expect(cache.limitMphAt(13.405, 52.52)).toBe(31);

    await cache.refresh(13.4051, 52.52, 'km/h');
    expect(fetchSigns).toHaveBeenCalledTimes(1);
  });

  it('fetches again once the car has moved past the refetch distance', async () => {
    const fetchSigns = jest
      .fn()
      .mockResolvedValueOnce([near(13.405, 52.52, 31)])
      .mockResolvedValueOnce([near(13.42, 52.52, 19)]);
    const cache = new SpeedLimitSignCache({ fetchSigns, refetchDistanceM: 100 });

    await cache.refresh(13.405, 52.52, 'km/h');
    // ~1 km east — well past the refetch distance.
    await cache.refresh(13.42, 52.52, 'km/h');

    expect(fetchSigns).toHaveBeenCalledTimes(2);
    expect(cache.size).toBe(2);
    expect(cache.limitMphAt(13.42, 52.52)).toBe(19);
  });

  it('collapses overlapping refreshes into one request', async () => {
    let resolveFetch: (value: SpeedLimitSign[]) => void = () => {};
    const fetchSigns = jest.fn(
      () =>
        new Promise<SpeedLimitSign[]>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const cache = new SpeedLimitSignCache({ fetchSigns });

    const first = cache.refresh(13.405, 52.52, 'km/h');
    const second = cache.refresh(13.405, 52.52, 'km/h');
    resolveFetch([near(13.405, 52.52, 31)]);
    await Promise.all([first, second]);

    expect(fetchSigns).toHaveBeenCalledTimes(1);
  });

  it('clears on reset so a new trip starts clean', async () => {
    const fetchSigns = jest.fn().mockResolvedValue([near(13.405, 52.52, 31)]);
    const cache = new SpeedLimitSignCache({ fetchSigns });

    await cache.refresh(13.405, 52.52, 'km/h');
    expect(cache.limitMphAt(13.405, 52.52)).toBe(31);

    cache.reset();
    expect(cache.size).toBe(0);
    expect(cache.limitMphAt(13.405, 52.52)).toBeNull();
  });
});
