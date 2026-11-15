/**
 * How a pack describes itself: size and shipped features.
 *
 * The card and the "Downloaded" shelf both summarise a pack, and they used to
 * compute it separately. That is how New York Metro advertised itself as
 * "185 MB total": the legacy per-part columns were preferred over the asset
 * manifest, and that row carries only its 194 MB geocoding estimate — while the
 * pack that actually downloads is 93 MB (4 MB tiles + 50 MB search + 10 MB
 * transit + 28 MB timetable).
 */

import {
  formatPackSize,
  manifestBytes,
  packContentsLabel,
  packFeatureLabels,
  packScope,
  packScopeLabel,
  packSizeBytes,
} from '../../src/services/regions/packSummary';
import type { Region } from '../../src/models/region';

const region = (over: Partial<Region> = {}): Region =>
  ({
    id: 'us-ny-new-york',
    name: 'New York Metro',
    bounds: { minLat: 40.4, maxLat: 41.0, minLng: -74.3, maxLng: -73.2 },
    version: '1',
    downloadStatus: 'none',
    tilesSizeBytes: null,
    routingSizeBytes: null,
    geocodingSizeBytes: null,
    downloadedAt: null,
    lastUpdated: null,
    driveKey: null,
    geocodingUrl: null,
    placesUrl: null,
    placesSizeBytes: null,
    tileVersion: null,
    ...over,
  }) as Region;

const NY_METRO = region({
  // The legacy columns as published: only its geocoding estimate is set.
  geocodingSizeBytes: 194_035_200,
  assets: [
    { name: 'tiles.pmtiles', url: '', sizeBytes: 4_138_134 },
    { name: 'search.sqlite', url: '', sizeBytes: 50_429_952 },
    { name: 'transit.sqlite', url: '', sizeBytes: 10_084_352 },
    { name: 'transit-timetable.sqlite', url: '', sizeBytes: 27_971_584 },
  ],
});

describe('packSizeBytes', () => {
  it('uses the asset manifest, not the legacy estimate', () => {
    expect(packSizeBytes(NY_METRO)).toBe(92_624_022);
    expect(formatPackSize(packSizeBytes(NY_METRO))).toBe('88 MB');
  });

  it('falls back to the legacy columns when a pack has no sized assets', () => {
    const legacy = region({
      tilesSizeBytes: 10 * 1024 * 1024,
      geocodingSizeBytes: 2 * 1024 * 1024,
    });
    expect(packSizeBytes(legacy)).toBe(12 * 1024 * 1024);
  });

  it('is zero when nothing is known', () => {
    expect(manifestBytes(region())).toBe(0);
    expect(packSizeBytes(region())).toBe(0);
    expect(formatPackSize(0)).toBeNull();
  });
});

describe('packFeatureLabels', () => {
  it('lists the features the manifest ships, in order and deduped', () => {
    expect(packFeatureLabels(NY_METRO)).toEqual(['Maps', 'Search', 'Transit', 'Timetable']);
  });

  it('ignores assets it has no label for', () => {
    const odd = region({ assets: [{ name: 'mystery.bin', url: '', sizeBytes: 10 }] });
    expect(packFeatureLabels(odd)).toEqual([]);
    expect(packContentsLabel(odd)).toBeNull();
  });

  it('renders a joined contents line', () => {
    expect(packContentsLabel(NY_METRO)).toBe('Maps · Search · Transit · Timetable');
  });

  it('shows no Timetable for the state pack, which publishes three assets', () => {
    const state = region({
      id: 'north-america-us-new-york',
      assets: [
        { name: 'tiles.pmtiles', url: '', sizeBytes: 38_870_080 },
        { name: 'search.sqlite', url: '', sizeBytes: 94_879_744 },
        { name: 'transit.sqlite', url: '', sizeBytes: 13_631_488 },
      ],
    });
    expect(packContentsLabel(state)).toBe('Maps · Search · Transit');
  });
});

describe('packScope', () => {
  const state = region({
    id: 'north-america-us-new-york',
    name: 'New York',
    assets: [
      { name: 'tiles.pmtiles', url: '', sizeBytes: 1 },
      { name: 'search.sqlite', url: '', sizeBytes: 1 },
      { name: 'transit.sqlite', url: '', sizeBytes: 1 },
    ],
  });

  it('labels the curated city pack as Metro', () => {
    expect(packScope(NY_METRO)).toBe('metro');
    expect(packScopeLabel(NY_METRO)).toBe('Metro');
  });

  it('labels the statewide extract as Regional, so the two New York packs differ', () => {
    // Same source PBF, same name prefix: the only thing that separates them in
    // a search result is this label.
    expect(packScope(state)).toBe('regional');
    expect(packScopeLabel(state)).toBe('Regional');
  });

  it('treats an unlisted pack that ships a timetable as a metro pack', () => {
    // New metro packs are published without a new app build; the timetable is
    // the signal the bundled catalogue cannot know about.
    const future = region({
      id: 'xx-unknown-city',
      assets: [
        { name: 'tiles.pmtiles', url: '', sizeBytes: 1 },
        { name: 'transit-timetable.sqlite', url: '', sizeBytes: 1 },
      ],
    });
    expect(packScope(future)).toBe('metro');
  });

  it('treats an unlisted pack without a timetable as regional', () => {
    const other = region({ id: 'yy-somewhere', assets: [{ name: 'tiles.pmtiles', url: '' }] });
    expect(packScope(other)).toBe('regional');
  });
});
