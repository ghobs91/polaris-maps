import { create } from 'zustand';

interface MapState {
  viewport: {
    lat: number;
    lng: number;
    zoom: number;
    bearing: number;
    pitch: number;
  };
  isLoadingTiles: boolean;
  selectedLocation: { lat: number; lng: number; name?: string } | null;
  mapStyle: 'default' | 'satellite' | 'terrain';
  // [minLng, minLat, maxLng, maxLat] — set to trigger camera fitBounds
  fitBounds: [number, number, number, number] | null;

  setViewport: (viewport: Partial<MapState['viewport']>) => void;
  setLoading: (loading: boolean) => void;
  setSelectedLocation: (location: MapState['selectedLocation']) => void;
  setMapStyle: (style: MapState['mapStyle']) => void;
  setFitBounds: (bounds: [number, number, number, number] | null) => void;
}

export const useMapStore = create<MapState>()((set) => ({
  viewport: {
    lat: 0,
    lng: 0,
    zoom: 2,
    bearing: 0,
    pitch: 0,
  },
  isLoadingTiles: false,
  selectedLocation: null,
  mapStyle: 'default',
  fitBounds: null,

  setViewport: (viewport) => set((state) => ({ viewport: { ...state.viewport, ...viewport } })),
  setLoading: (isLoadingTiles) => set({ isLoadingTiles }),
  setSelectedLocation: (selectedLocation) => set({ selectedLocation }),
  setMapStyle: (mapStyle) => set({ mapStyle }),
  setFitBounds: (fitBounds) => set({ fitBounds }),
}));
