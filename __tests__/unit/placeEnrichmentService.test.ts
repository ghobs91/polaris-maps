import type { SavedPlace } from '../../src/models/placeList';

jest.mock('../../src/services/poi/osmFetcher', () => ({
  fetchOsmPois: jest.fn(),
}));

import { fetchOsmPois, type OsmPoi } from '../../src/services/poi/osmFetcher';
import {
  clearPlaceEnrichmentCache,
  loadPlaceEnrichmentForPlaces,
} from '../../src/services/places/placeEnrichmentService';

const mockFetch = fetchOsmPois as jest.Mock;

function place(overrides: Partial<SavedPlace>): SavedPlace {
  return { id: 'p1', name: 'The Early Bird Cafe', lat: 40, lng: -73, addedAt: 1, ...overrides };
}

function poi(overrides: Partial<OsmPoi>): OsmPoi {
  return {
    id: 1,
    name: 'The Early Bird Cafe',
    lat: 40.0005,
    lng: -73.0005,
    type: 'amenity',
    subtype: 'cafe',
    tags: {
      opening_hours: 'Mo-Fr 08:00-17:00',
      website: 'https://earlybird.example/',
    },
    ...overrides,
  };
}

describe('loadPlaceEnrichmentForPlaces', () => {
  beforeEach(() => {
    clearPlaceEnrichmentCache();
    mockFetch.mockReset();
  });

  it('matches a nearby same-name POI and returns hours + website', async () => {
    mockFetch.mockResolvedValue([poi({})]);
    const result = await loadPlaceEnrichmentForPlaces([place({})]);
    expect(result.p1).toEqual({
      openingHours: 'Mo-Fr 08:00-17:00',
      website: 'https://earlybird.example/',
    });
  });

  it('falls back to contact:website and ignores POIs with no enrichment', async () => {
    mockFetch.mockResolvedValue([
      poi({ tags: { 'contact:website': 'https://contact.example/' } }),
      poi({ id: 2, name: 'Somewhere Else', tags: {} }),
      poi({ id: 3, tags: {} }),
    ]);
    const result = await loadPlaceEnrichmentForPlaces([place({})]);
    expect(result.p1).toEqual({ website: 'https://contact.example/' });
  });

  it('ignores name mismatches and distant POIs', async () => {
    mockFetch.mockResolvedValue([poi({ name: 'Somewhere Else' }), poi({ lat: 40.5, lng: -73.5 })]);
    const result = await loadPlaceEnrichmentForPlaces([place({})]);
    expect(result.p1).toBeUndefined();
  });

  it('skips the Overpass lookup when the list spans too large an area', async () => {
    const result = await loadPlaceEnrichmentForPlaces([
      place({ id: 'a', lat: 40, lng: -73 }),
      place({ id: 'b', lat: 41, lng: -73 }),
    ]);
    expect(result).toEqual({});
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('ignores places without coordinates', async () => {
    const result = await loadPlaceEnrichmentForPlaces([place({ lat: 0, lng: 0 })]);
    expect(result).toEqual({});
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('caches results across calls', async () => {
    mockFetch.mockResolvedValue([poi({})]);
    const places = [place({})];
    await loadPlaceEnrichmentForPlaces(places);
    await loadPlaceEnrichmentForPlaces(places);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
