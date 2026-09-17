import { exportFilename, toCSV, toGeoJSON } from '../../src/services/places/exportService';
import { mergeList } from '../../src/services/places/placeListMerge';
import { parseCSV } from '../../src/services/places/importService';
import type { PlaceList, SavedPlace } from '../../src/models/placeList';

function place(overrides: Partial<SavedPlace> = {}): SavedPlace {
  return {
    id: 'p1',
    name: 'Cafe',
    lat: 40.7,
    lng: -74,
    addedAt: 1,
    ...overrides,
  };
}

function list(overrides: Partial<PlaceList> = {}): PlaceList {
  return {
    id: 'list-a',
    name: 'Favorites',
    isPrivate: true,
    places: [place()],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('list export', () => {
  it('serializes CSV that round-trips through the importer', () => {
    const csv = toCSV(list({ places: [place({ name: 'Cafe, "Best"', note: 'line1' })] }));
    expect(csv.split('\n')[0]).toContain('Title,Note');

    const reparsed = parseCSV(csv);
    expect(reparsed.places[0].name).toBe('Cafe, "Best"');
    expect(reparsed.places[0].lat).toBeCloseTo(40.7, 5);
  });

  it('omits tombstoned places from exports', () => {
    const csv = toCSV(list({ places: [place(), place({ id: 'p2', deleted: true })] }));
    expect(csv.split('\n')).toHaveLength(2);
  });

  it('serializes GeoJSON with [lng, lat] coordinates', () => {
    const parsed = JSON.parse(toGeoJSON(list()));
    expect(parsed.type).toBe('FeatureCollection');
    expect(parsed.features[0].geometry.coordinates).toEqual([-74, 40.7]);
    expect(parsed.features[0].properties.name).toBe('Cafe');
  });

  it('builds a sanitized filename', () => {
    expect(exportFilename(list({ name: 'My Trips! 2026' }))).toBe('my-trips-2026');
    expect(exportFilename(list({ name: '' }))).toBe('places');
  });
});

describe('mergeList', () => {
  it('is order-independent (converges)', () => {
    const a = list({ updatedAt: 2, places: [place({ id: 'x', updatedAt: 2 })] });
    const b = list({ id: 'list-b', name: 'Shared', updatedAt: 3, places: [place({ id: 'y' })] });

    expect(mergeList(a, b)).toEqual(mergeList(b, a));
    expect(mergeList(a, b).name).toBe('Shared');
  });

  it('does not resurrect a tombstoned place', () => {
    const local = list({
      updatedAt: 5,
      places: [place({ id: 'x', updatedAt: 5, deleted: true })],
    });
    const remote = list({ id: 'list-b', updatedAt: 1, places: [place({ id: 'x', updatedAt: 1 })] });

    const merged = mergeList(local, remote);
    expect(merged.places.find((p) => p.id === 'x')).toBeUndefined();
  });

  it('dedupes concurrent adds of the same place and keeps the newest edit', () => {
    const local = list({ updatedAt: 2, places: [place({ id: 'x', note: 'first', updatedAt: 1 })] });
    const remote = list({
      id: 'list-b',
      updatedAt: 3,
      places: [place({ id: 'y', note: 'second', updatedAt: 2 })],
    });

    const merged = mergeList(local, remote);
    const samePlace = merged.places.filter((p) => p.name === 'Cafe');
    expect(samePlace).toHaveLength(1);
    expect(samePlace[0].note).toBe('second');
  });

  it('resolves renames by last write', () => {
    const local = list({ name: 'New Name', updatedAt: 10 });
    const remote = list({ id: 'list-b', name: 'Old Name', updatedAt: 5 });
    expect(mergeList(local, remote).name).toBe('New Name');
    expect(mergeList(remote, local).name).toBe('New Name');
  });
});
