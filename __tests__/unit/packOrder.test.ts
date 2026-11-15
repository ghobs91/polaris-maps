/**
 * Ordering and filtering for the offline-pack list.
 *
 * The list mixes every pack state — the search has to find the pack being
 * downloaded and the ones already on disk, not only the ones waiting. This was
 * split out of the component after the search returned zero results for "new
 * york" while the New York pack was mid-download: the list excluded active
 * packs, so the one the user cared about most was the one they could not find.
 */

import { orderPacks, filterPacks } from '../../src/services/regions/packOrder';
import type { Region } from '../../src/models/region';

const pack = (id: string, name: string, downloadStatus: Region['downloadStatus']): Region =>
  ({
    id,
    name,
    bounds: { minLat: 0, maxLat: 1, minLng: 0, maxLng: 1 },
    version: '1',
    downloadStatus,
    downloadedAt: null,
    lastUpdated: null,
    driveKey: null,
    tilesSizeBytes: null,
    routingSizeBytes: null,
    geocodingSizeBytes: null,
    geocodingUrl: null,
    placesUrl: null,
    placesSizeBytes: null,
    tileVersion: null,
  }) as Region;

describe('orderPacks', () => {
  it('puts the active download first, downloaded last', () => {
    const ordered = orderPacks([
      pack('a', 'Albania', 'none'),
      pack('b', 'Berlin', 'complete'),
      pack('c', 'Cairo', 'downloading'),
      pack('d', 'Dakar', 'failed'),
    ]);
    expect(ordered.map((r) => r.name)).toEqual(['Cairo', 'Dakar', 'Albania', 'Berlin']);
  });

  it('is alphabetical within a status group', () => {
    const ordered = orderPacks([pack('b', 'Berlin', 'none'), pack('a', 'Athens', 'none')]);
    expect(ordered.map((r) => r.name)).toEqual(['Athens', 'Berlin']);
  });

  it('does not mutate the input', () => {
    const input = [pack('b', 'Berlin', 'none'), pack('a', 'Athens', 'none')];
    orderPacks(input);
    expect(input.map((r) => r.name)).toEqual(['Berlin', 'Athens']);
  });
});

describe('filterPacks', () => {
  const packs = [
    pack('us-ny-new-york', 'New York Metro', 'downloading'),
    pack('jp-tokyo', 'Tokyo', 'none'),
  ];

  it('matches case-insensitively across states', () => {
    // The failing case: a mid-download pack must be findable.
    expect(filterPacks(packs, 'new york').map((r) => r.id)).toEqual(['us-ny-new-york']);
    expect(filterPacks(packs, 'TOKYO').length).toBe(1);
  });

  it('matches the id too', () => {
    expect(filterPacks(packs, 'jp-tokyo').map((r) => r.name)).toEqual(['Tokyo']);
  });

  it('returns everything for blank or whitespace queries', () => {
    expect(filterPacks(packs, '')).toHaveLength(2);
    expect(filterPacks(packs, '   ')).toHaveLength(2);
  });
});
