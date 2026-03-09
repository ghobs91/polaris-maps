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

  setViewport: (viewport: Partial<MapState['viewport']>) => void;
  setLoading: (loading: boolean) => void;
  setSelectedLocation: (location: MapState['selectedLocation']) => void;
  setMapStyle: (style: MapState['mapStyle']) => void;
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

  setViewport: (viewport) => set((state) => ({ viewport: { ...state.viewport, ...viewport } })),
  setLoading: (isLoadingTiles) => set({ isLoadingTiles }),
  setSelectedLocation: (selectedLocation) => set({ selectedLocation }),
  setMapStyle: (mapStyle) => set({ mapStyle }),
}));
