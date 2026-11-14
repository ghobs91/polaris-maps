/**
 * Onboarding pack suggestion.
 *
 * The gate used to offer only Geofabrik nodes, which have no pack and therefore
 * download as OpenFreeMap tiles capped at 50 MB — so "New York" failed every
 * time for a new user. These pin which pack is offered instead.
 */

import { packRegions, pickNearestPackRegion } from '../../src/services/regions/nearestPackRegion';
import type { Region } from '../../src/models/region';

const PACK = [{ name: 'tiles.pmtiles', url: 'https://packs.test/tiles.pmtiles' }];

function region(id: string, bounds: Region['bounds'], assets = PACK): Region {
  return {
    id,
    name: id,
    bounds,
    version: '1.0',
    downloadStatus: 'none',
    downloadedAt: null,
    assets,
  };
}

const NYC = { minLat: 40.4, maxLat: 41.1, minLng: -74.5, maxLng: -73.5 };
const NY_STATE = { minLat: 40.4, maxLat: 45.1, minLng: -79.8, maxLng: -71.8 };
const LONDON = { minLat: 51.2, maxLat: 51.8, minLng: -0.6, maxLng: 0.3 };

describe('packRegions', () => {
  it('keeps only regions with a manifest', () => {
    const all = [
      region('us-ny-new-york', NYC),
      region('north-america-us-new-york', NY_STATE, []),
      region('gb-england-london', LONDON),
    ];
    expect(packRegions(all).map((r) => r.id)).toEqual(['us-ny-new-york', 'gb-england-london']);
  });
});

describe('pickNearestPackRegion', () => {
  it('returns null when nothing has a pack', () => {
    expect(pickNearestPackRegion([region('a', NYC, [])], 40.7, -74)).toBeNull();
    expect(pickNearestPackRegion([], 40.7, -74)).toBeNull();
  });

  it('prefers the smallest pack containing the point', () => {
    // A state and a metro both contain Manhattan; the metro is the sane offer.
    const pick = pickNearestPackRegion(
      [region('north-america-us-new-york', NY_STATE), region('us-ny-new-york', NYC)],
      40.75,
      -73.99,
    );
    expect(pick!.id).toBe('us-ny-new-york');
  });

  it('falls back to the nearest pack when the point is outside all of them', () => {
    const pick = pickNearestPackRegion(
      [region('us-ny-new-york', NYC), region('gb-england-london', LONDON)],
      51.5,
      -0.12, // London
    );
    expect(pick!.id).toBe('gb-england-london');
  });

  it('ignores packs without a manifest when choosing', () => {
    const pick = pickNearestPackRegion(
      [region('north-america-us-new-york', NY_STATE, []), region('us-ny-new-york', NYC)],
      44.0,
      -75.0, // inside the state, outside the metro
    );
    // Only the metro has a pack, so it is offered rather than the closer state.
    expect(pick!.id).toBe('us-ny-new-york');
  });

  it('offers something downloadable when there is no location', () => {
    const pick = pickNearestPackRegion([region('gb-england-london', LONDON)], null, null);
    expect(pick!.id).toBe('gb-england-london');
  });

  it('is deterministic without a location', () => {
    const a = pickNearestPackRegion(
      [region('zz-last', LONDON), region('aa-first', NYC)],
      undefined,
      undefined,
    );
    const b = pickNearestPackRegion(
      [region('aa-first', NYC), region('zz-last', LONDON)],
      undefined,
      undefined,
    );
    expect(a!.id).toBe('aa-first');
    expect(b!.id).toBe('aa-first');
  });

  it('ignores a non-finite location rather than ranking by NaN', () => {
    const pick = pickNearestPackRegion([region('us-ny-new-york', NYC)], Number.NaN, 0);
    expect(pick!.id).toBe('us-ny-new-york');
  });
});
