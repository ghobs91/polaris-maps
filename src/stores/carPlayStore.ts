import { create } from 'zustand';

interface CarPlayState {
  /** True while a CarPlay scene is attached (main template or dashboard). */
  connected: boolean;
  setConnected: (connected: boolean) => void;
}

/**
 * Reactive CarPlay connection state for the UI. `carPlayManager` mirrors the
 * native connect/disconnect events here so screens can adapt (e.g. the phone
 * navigation screen shows the steps list + add-stop search while CarPlay drives
 * the map).
 */
export const useCarPlayStore = create<CarPlayState>()((set) => ({
  connected: false,
  setConnected: (connected) => set({ connected }),
}));
