import {
  getConfiguredFeedUrls,
  normalizeOpenFeedResponse,
} from '../../src/services/traffic/openTrafficFeed';

describe('normalizeOpenFeedResponse', () => {
  it('normalizes a bare array and computes the congestion ratio', () => {
    const segments = normalizeOpenFeedResponse([
      { id: 'a', lat: 40.7, lng: -74, speedMph: 30, freeFlowSpeedMph: 60 },
    ]);

    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({
      id: 'a',
      coordinates: [[-74, 40.7]],
      currentSpeedMph: 30,
      freeFlowSpeedMph: 60,
      congestionRatio: 0.5,
      source: 'open_feed',
    });
  });

  it('accepts a { segments: [...] } envelope', () => {
    const segments = normalizeOpenFeedResponse({
      segments: [{ lat: 1, lng: 2, speedMph: 10, freeFlowSpeedMph: 20 }],
    });
    expect(segments).toHaveLength(1);
  });

  it('drops invalid rows without throwing', () => {
    const segments = normalizeOpenFeedResponse([
      { lat: 'nope', lng: 2, speedMph: 10, freeFlowSpeedMph: 20 },
      { lat: 1, lng: 2, speedMph: 10, freeFlowSpeedMph: 0 },
      { lat: 3, lng: 4, speedMph: 25, freeFlowSpeedMph: 50 },
    ]);
    expect(segments).toHaveLength(1);
    expect(segments[0].coordinates[0]).toEqual([4, 3]);
  });

  it('clamps the congestion ratio into [0, 1]', () => {
    const [segment] = normalizeOpenFeedResponse([
      { lat: 1, lng: 2, speedMph: 90, freeFlowSpeedMph: 60 },
    ]);
    expect(segment.congestionRatio).toBe(1);
  });

  it('returns nothing for unusable payloads', () => {
    expect(normalizeOpenFeedResponse(null)).toEqual([]);
    expect(normalizeOpenFeedResponse({ foo: 'bar' })).toEqual([]);
    expect(normalizeOpenFeedResponse('nope')).toEqual([]);
  });
});

describe('getConfiguredFeedUrls', () => {
  it('parses and trims a comma-separated list', () => {
    expect(getConfiguredFeedUrls('https://a.gov/t.json, https://b.gov/t.json ')).toEqual([
      'https://a.gov/t.json',
      'https://b.gov/t.json',
    ]);
  });

  it('returns nothing when unset or blank', () => {
    expect(getConfiguredFeedUrls(undefined)).toEqual([]);
    expect(getConfiguredFeedUrls('')).toEqual([]);
    expect(getConfiguredFeedUrls(' , ')).toEqual([]);
  });
});
