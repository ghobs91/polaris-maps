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
  tileServerPort: number | null;

  setViewport: (viewport: Partial<MapState['viewport']>) => void;
  setLoading: (loading: boolean) => void;
  setSelectedLocation: (location: MapState['selectedLocation']) => void;
  setMapStyle: (style: MapState['mapStyle']) => void;
  setTileServerPort: (port: number | null) => void;
}

export const useMapStore = create<MapState>()((set) => ({
  viewport: {
    lat: 34.0522,
    lng: -118.2437,
    zoom: 12,
    bearing: 0,
    pitch: 0,
  },
  isLoadingTiles: false,
  selectedLocation: null,
  mapStyle: 'default',
  tileServerPort: null,

  setViewport: (viewport) => set((state) => ({ viewport: { ...state.viewport, ...viewport } })),
  setLoading: (isLoadingTiles) => set({ isLoadingTiles }),
  setSelectedLocation: (selectedLocation) => set({ selectedLocation }),
  setMapStyle: (mapStyle) => set({ mapStyle }),
  setTileServerPort: (tileServerPort) => set({ tileServerPort }),
}));
