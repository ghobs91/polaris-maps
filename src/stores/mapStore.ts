import { create } from 'zustand';
import { storage } from '../services/storage/mmkv';

const LAYER_KEY = 'mapLayerToggles';

function loadLayerToggles(): { trafficLayerVisible: boolean } {
  const raw = storage.getString(LAYER_KEY);
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {
      /* ignore */
    }
  }
  return { trafficLayerVisible: false };
}

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
  trafficLayerVisible: boolean;
  // [minLng, minLat, maxLng, maxLat] — set to trigger camera fitBounds
  fitBounds: [number, number, number, number] | null;
  // Set from outside the map tab (e.g. POI detail) to auto-trigger directions
  pendingDirectionsTarget: { lat: number; lng: number; name: string } | null;
  // Incremented by locateTo so MapView always flies even when position/zoom unchanged
  locateTrigger: number;

  setViewport: (viewport: Partial<MapState['viewport']>) => void;
  /** Update viewport and force the camera to fly, even if lat/lng/zoom are unchanged. */
  locateTo: (lat: number, lng: number, zoom: number) => void;
  setLoading: (loading: boolean) => void;
  setSelectedLocation: (location: MapState['selectedLocation']) => void;
  setMapStyle: (style: MapState['mapStyle']) => void;
  setTrafficLayerVisible: (visible: boolean) => void;
  setFitBounds: (bounds: [number, number, number, number] | null) => void;
  setPendingDirectionsTarget: (target: MapState['pendingDirectionsTarget']) => void;
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
  trafficLayerVisible: loadLayerToggles().trafficLayerVisible,
  fitBounds: null,
  pendingDirectionsTarget: null,
  locateTrigger: 0,

  setViewport: (viewport) => set((state) => ({ viewport: { ...state.viewport, ...viewport } })),
  locateTo: (lat, lng, zoom) =>
    set((s) => ({
      viewport: { ...s.viewport, lat, lng, zoom },
      locateTrigger: s.locateTrigger + 1,
    })),
  setLoading: (isLoadingTiles) => set({ isLoadingTiles }),
  setSelectedLocation: (selectedLocation) => set({ selectedLocation }),
  setMapStyle: (mapStyle) => set({ mapStyle }),
  setTrafficLayerVisible: (trafficLayerVisible) => {
    set({ trafficLayerVisible });
    storage.set(LAYER_KEY, JSON.stringify({ trafficLayerVisible }));
  },
  setFitBounds: (fitBounds) => set({ fitBounds }),
  setPendingDirectionsTarget: (pendingDirectionsTarget) => set({ pendingDirectionsTarget }),
}));
