import { useOsmPoiStore } from '../../src/stores/osmPoiStore';
import type { OsmPoi } from '../../src/services/poi/osmFetcher';

const poi: OsmPoi = {
  id: 1,
  lat: 40.75,
  lng: -73.99,
  name: 'Spot',
  type: 'amenity',
  subtype: 'restaurant',
  tags: {},
};

beforeEach(() => {
  useOsmPoiStore.setState({
    categorySearchResults: null,
    categoryFilter: null,
    categorySearchLocalPrimary: false,
    isCategorySearching: false,
    viewportPoiRefreshToken: 0,
  });
});

describe('osmPoiStore', () => {
  it('does not request a viewport refresh when no override was active', () => {
    useOsmPoiStore.getState().clearCategorySearch();

    expect(useOsmPoiStore.getState().viewportPoiRefreshToken).toBe(0);
  });

  it('requests a viewport refresh when the search override ends', () => {
    useOsmPoiStore.getState().setCategorySearch(['restaurant'], [poi], false);
    useOsmPoiStore.getState().clearCategorySearch();

    const state = useOsmPoiStore.getState();
    expect(state.categorySearchResults).toBeNull();
    expect(state.categoryFilter).toBeNull();
    expect(state.isCategorySearching).toBe(false);
    // The map reloads regular POIs off this token (no pan/zoom needed).
    expect(state.viewportPoiRefreshToken).toBe(1);
  });
});
