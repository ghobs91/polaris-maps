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
  clearCategorySearch: () =>
    set({
      categoryFilter: null,
      categorySearchResults: null,
      categorySearchLocalPrimary: false,
      isCategorySearching: false,
    }),
}));
