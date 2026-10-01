/**
 * Tests for Sentinel-2 scene discovery (Earth Search STAC lookup).
 */

import {
  findLatestSentinelScene,
  SENTINEL_MAX_CLOUD_COVER,
} from '../../src/services/map/sentinelStac';

function jsonFetch(
  body: unknown,
  ok = true,
): { fetchImpl: typeof fetch; calls: () => number; urls: () => string[] } {
  const urls: string[] = [];
  const fetchImpl = (async (url: string) => {
    urls.push(url);
    return { ok, json: async () => body } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls: () => urls.length, urls: () => urls };
}

function featureCollection(features: unknown[]): unknown {
  return { type: 'FeatureCollection', features };
}

describe('findLatestSentinelScene', () => {
  it('returns the newest scene intersecting the viewport', async () => {
    const { fetchImpl } = jsonFetch(
      featureCollection([
        { id: 'old', properties: { datetime: '2026-01-01T00:00:00Z', 'eo:cloud_cover': 5 } },
        { id: 'new', properties: { datetime: '2026-09-26T10:00:00Z', 'eo:cloud_cover': 2.8 } },
      ]),
    );
    const scene = await findLatestSentinelScene([12, 41, 13, 42], { fetchImpl });
    expect(scene).toEqual({
      id: 'new',
      datetime: '2026-09-26T10:00:00Z',
      cloudCover: 2.8,
    });
  });

  it('falls back to start_datetime and tolerates a missing cloud value', async () => {
    const { fetchImpl } = jsonFetch(
      featureCollection([{ id: 'a', properties: { start_datetime: '2026-05-05T00:00:00Z' } }]),
    );
    const scene = await findLatestSentinelScene([13, 41, 14, 42], { fetchImpl });
    expect(scene).toEqual({ id: 'a', datetime: '2026-05-05T00:00:00Z', cloudCover: null });
  });

  it('returns null when there are no usable features', async () => {
    const { fetchImpl } = jsonFetch(
      featureCollection([{ id: 'x', properties: {} }, { properties: { datetime: 'bad' } }]),
    );
    expect(await findLatestSentinelScene([14, 41, 15, 42], { fetchImpl })).toBeNull();
  });

  it('returns null on a non-ok response', async () => {
    const { fetchImpl } = jsonFetch({}, false);
    expect(await findLatestSentinelScene([15, 41, 16, 42], { fetchImpl })).toBeNull();
  });

  it('requests only scenes under the cloud-cover threshold', async () => {
    const { fetchImpl, urls } = jsonFetch(featureCollection([]));
    await findLatestSentinelScene([16, 41, 17, 42], { fetchImpl });
    const requested = new URL(urls()[0]);
    expect(requested.searchParams.get('bbox')).toBe('16,41,17,42');
    expect(JSON.parse(requested.searchParams.get('query') ?? '{}')).toEqual({
      'eo:cloud_cover': { lt: SENTINEL_MAX_CLOUD_COVER },
    });
  });

  it('caches successful lookups for the same viewport', async () => {
    const { fetchImpl, calls } = jsonFetch(
      featureCollection([{ id: 'c', properties: { datetime: '2026-02-02T00:00:00Z' } }]),
    );
    const first = await findLatestSentinelScene([17, 41, 18, 42], { fetchImpl });
    const second = await findLatestSentinelScene([17, 41, 18, 42], { fetchImpl });
    expect(second).toEqual(first);
    expect(calls()).toBe(1);
  });
});
