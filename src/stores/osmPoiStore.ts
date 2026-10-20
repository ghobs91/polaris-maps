import { create } from 'zustand';
import type { OsmPoi } from '../services/poi/osmFetcher';
import type { EnrichedPoiData } from '../services/poi/poiEnricher';
import type { ViewportBounds } from '../utils/poiSpatialFilter';
import type { PlaceCategory } from '../models/poi';

interface OsmPoiState {
  pois: OsmPoi[];
  selectedPoi: OsmPoi | null;
  isLoading: boolean;
  currentZoom: number;
  viewportBounds: ViewportBounds | null;
  enrichedData: EnrichedPoiData | null;
  isEnriching: boolean;
  /** Active category filter (from search like "coffeeshops") */
  categoryFilter: PlaceCategory[] | null;
  /** POIs returned by category search (shown instead of default POIs) */
  categorySearchResults: OsmPoi[] | null;
  /** Whether local Overture data was the primary source for the last search */
  categorySearchLocalPrimary: boolean;
  isCategorySearching: boolean;
  /**
   * Bumped whenever a category/search override ends. The map uses it to reload
   * the regular viewport POIs, which the override had replaced.
   */
  viewportPoiRefreshToken: number;
  setPois: (pois: OsmPoi[]) => void;
  setSelectedPoi: (poi: OsmPoi | null) => void;
  setIsLoading: (loading: boolean) => void;
  setZoomAndBounds: (zoom: number, bounds: ViewportBounds) => void;
  setEnrichedData: (data: EnrichedPoiData | null) => void;
  setIsEnriching: (loading: boolean) => void;
  setCategorySearch: (
    categories: PlaceCategory[] | null,
    results: OsmPoi[] | null,
    localPrimary: boolean,
  ) => void;
  setIsCategorySearching: (loading: boolean) => void;
  clearCategorySearch: () => void;
}

export const useOsmPoiStore = create<OsmPoiState>((set, get) => ({
  pois: [],
  selectedPoi: null,
  isLoading: false,
  currentZoom: 0,
  viewportBounds: null,
  enrichedData: null,
  isEnriching: false,
  categoryFilter: null,
  categorySearchResults: null,
  categorySearchLocalPrimary: false,
  isCategorySearching: false,
  viewportPoiRefreshToken: 0,
  setPois: (pois) => {
    const state = get();
    // Skip update if POI IDs haven't changed — avoids re-renders when the
    // same results come back from repeated fetches of the same viewport.
    if (state.pois.length === pois.length && state.pois.every((p, i) => p.id === pois[i].id)) {
      return;
    }
    set({ pois });
  },
  setSelectedPoi: (selectedPoi) => set({ selectedPoi, enrichedData: null }),
  setIsLoading: (isLoading) => set({ isLoading }),
  setZoomAndBounds: (zoom, bounds) => set({ currentZoom: zoom, viewportBounds: bounds }),
  setEnrichedData: (enrichedData) => set({ enrichedData }),
  setIsEnriching: (isEnriching) => set({ isEnriching }),
  setCategorySearch: (categoryFilter, categorySearchResults, categorySearchLocalPrimary) =>
    set({ categoryFilter, categorySearchResults, categorySearchLocalPrimary }),
  setIsCategorySearching: (isCategorySearching) => set({ isCategorySearching }),
  clearCategorySearch: () => {
    // The override replaced the map's viewport POIs, so ending it must put the
    // regular POIs back. Bumping the token makes the map reload them for the
    // viewport it is already showing (no pan/zoom needed to recover).
    const { categorySearchResults, viewportPoiRefreshToken } = get();
    set({
      categoryFilter: null,
      categorySearchResults: null,
      categorySearchLocalPrimary: false,
      isCategorySearching: false,
      viewportPoiRefreshToken:
        categorySearchResults !== null ? viewportPoiRefreshToken + 1 : viewportPoiRefreshToken,
    });
  },
}));
