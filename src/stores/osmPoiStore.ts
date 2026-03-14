import { create } from 'zustand';
import type { OsmPoi } from '../services/poi/osmFetcher';
import type { ViewportBounds } from '../utils/poiSpatialFilter';

interface OsmPoiState {
  pois: OsmPoi[];
  selectedPoi: OsmPoi | null;
  isLoading: boolean;
  currentZoom: number;
  viewportBounds: ViewportBounds | null;
  setPois: (pois: OsmPoi[]) => void;
  setSelectedPoi: (poi: OsmPoi | null) => void;
  setIsLoading: (loading: boolean) => void;
  setZoomAndBounds: (zoom: number, bounds: ViewportBounds) => void;
}

export const useOsmPoiStore = create<OsmPoiState>((set) => ({
  pois: [],
  selectedPoi: null,
  isLoading: false,
  currentZoom: 0,
  viewportBounds: null,
  setPois: (pois) => set({ pois }),
  setSelectedPoi: (selectedPoi) => set({ selectedPoi }),
  setIsLoading: (isLoading) => set({ isLoading }),
  setZoomAndBounds: (zoom, bounds) => set({ currentZoom: zoom, viewportBounds: bounds }),
}));
