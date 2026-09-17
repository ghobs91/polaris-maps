/**
 * Automated coverage for the transit endpoint/GTFS source-selection matrix:
 * each city and country capital must resolve to the intended source, city
 * endpoints must beat their country feed, and uncovered regions must fall back
 * to the DOT GTFS registry (US) or Transitous (global).
 */

import { findEndpointForCoords } from '../../src/services/transit/otpEndpointRegistry';
import { GTFS_CONFIGS } from '../../src/services/transit/transitLineFetcher';

function apiStyleAt(lat: number, lon: number): string | null {
  return findEndpointForCoords(lat, lon)?.apiStyle ?? null;
}

describe('city endpoint resolution', () => {
  it.each([
    ['Washington DC', 38.9072, -77.0369, 'wmata-gtfs-v1'],
    ['Chicago', 41.8781, -87.6298, 'cta-gtfs-v1'],
    ['San Francisco', 37.7749, -122.4194, 'bart-gtfs-v1'],
    ['Philadelphia', 39.9526, -75.1652, 'septa-gtfs-v1'],
    ['Los Angeles', 34.0522, -118.2437, 'lametro-gtfs-v1'],
    ['London', 51.5074, -0.1278, 'tfl-v1'],
    ['Paris', 48.8566, 2.3522, 'idfm-gtfs-v1'],
  ])('%s resolves to %s', (_city, lat, lon, expected) => {
    expect(apiStyleAt(lat, lon)).toBe(expected);
  });

  it('falls back to the DOT GTFS registry for uncovered US cities', () => {
    expect(apiStyleAt(39.7392, -104.9903)).toBe('dot-gtfs'); // Denver
    expect(apiStyleAt(47.6062, -122.3321)).toBe('dot-gtfs'); // Seattle
  });
});

describe('country endpoint resolution', () => {
  it.each([
    ['Copenhagen', 55.6761, 12.5683, 'dk-gtfs-v1'],
    ['Helsinki', 60.1699, 24.9384, 'fi-gtfs-v1'],
    ['Zurich', 47.3769, 8.5417, 'ch-gtfs-v1'],
    ['Amsterdam', 52.3676, 4.9041, 'nl-gtfs-v1'],
    ['Dublin', 53.3498, -6.2603, 'ie-gtfs-v1'],
    ['Stockholm', 59.3293, 18.0686, 'se-gtfs-v1'],
    ['Oslo', 59.9139, 10.7522, 'no-gtfs-v1'],
    ['Luxembourg City', 49.6116, 6.1319, 'lu-gtfs-v1'],
    ['Tallinn', 59.437, 24.7536, 'ee-gtfs-v1'],
    ['Hamburg', 53.5511, 9.9937, 'de-gtfs-v1'],
  ])('%s resolves to %s', (_city, lat, lon, expected) => {
    expect(apiStyleAt(lat, lon)).toBe(expected);
  });

  it('prefers the VBB Berlin city feed over the Germany country feed', () => {
    expect(apiStyleAt(52.52, 13.405)).toBe('vbb-gtfs-v1');
  });

  it('falls back to the global Transitous endpoint outside any country feed', () => {
    expect(apiStyleAt(39.9042, 116.4074)).toBe('transitous-v1'); // Beijing
    expect(apiStyleAt(-33.8688, 151.2093)).toBe('transitous-v1'); // Sydney
  });
});

describe('country GTFS configs', () => {
  it.each([
    'ch-gtfs-v1',
    'de-gtfs-v1',
    'dk-gtfs-v1',
    'ee-gtfs-v1',
    'fi-gtfs-v1',
    'ie-gtfs-v1',
    'lu-gtfs-v1',
    'nl-gtfs-v1',
    'no-gtfs-v1',
    'se-gtfs-v1',
  ])('%s is registered without route-type filtering', (style) => {
    const config = GTFS_CONFIGS[style];
    expect(config).toBeDefined();
    expect(config.filterByRouteType).toBe(false);
    expect(config.timeoutMs).toBeGreaterThanOrEqual(45_000);
  });

  it('keeps the Denmark feed timeout at 60s', () => {
    expect(GTFS_CONFIGS['dk-gtfs-v1'].timeoutMs).toBe(60_000);
  });
});
