import { create } from 'zustand';
import { storage } from '../services/storage/mmkv';

const STREET_VIEW_LAYER_KEY = 'streetViewLayerVisible';

interface StreetViewState {
  /** Whether the street-view coverage overlay is drawn on the map. */
  streetViewLayerVisible: boolean;
  setStreetViewLayerVisible: (visible: boolean) => void;
}

export const useStreetViewStore = create<StreetViewState>()((set) => ({
  streetViewLayerVisible: storage.getBoolean(STREET_VIEW_LAYER_KEY) ?? false,
  setStreetViewLayerVisible: (visible) => {
    set({ streetViewLayerVisible: visible });
    storage.set(STREET_VIEW_LAYER_KEY, visible);
  },
}));
