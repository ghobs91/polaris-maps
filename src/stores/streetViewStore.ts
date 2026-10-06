import { create } from 'zustand';
import { storage } from '../services/storage/mmkv';

const STREET_VIEW_LAYER_KEY = 'streetViewLayerVisible';

interface StreetViewState {
  /** Whether the street-view coverage overlay is drawn on the map. */
  streetViewLayerVisible: boolean;
  setStreetViewLayerVisible: (visible: boolean) => void;
  /**
   * Street-level preview thumbnail for the selected place, floated over the map
   * by the map screen. Null when no panorama exists.
   */
  thumbUrl: string | null;
  setThumbUrl: (thumbUrl: string | null) => void;
}

export const useStreetViewStore = create<StreetViewState>()((set) => ({
  streetViewLayerVisible: storage.getBoolean(STREET_VIEW_LAYER_KEY) ?? false,
  setStreetViewLayerVisible: (visible) => {
    set({ streetViewLayerVisible: visible });
    storage.set(STREET_VIEW_LAYER_KEY, visible);
  },
  thumbUrl: null,
  setThumbUrl: (thumbUrl) => set({ thumbUrl }),
}));
