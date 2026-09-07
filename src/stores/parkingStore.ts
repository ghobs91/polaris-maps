import { create } from 'zustand';
import * as Location from 'expo-location';
import { storage } from '../services/storage/mmkv';

export interface ParkingSpot {
  lat: number;
  lng: number;
  savedAt: number;
  label?: string;
}

const PARKING_KEY = 'parking_spot_v1';

function loadSpot(): ParkingSpot | null {
  try {
    const raw = storage.getString(PARKING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ParkingSpot;
    if (typeof parsed.lat !== 'number' || typeof parsed.lng !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

function persist(spot: ParkingSpot | null): void {
  try {
    if (spot) storage.set(PARKING_KEY, JSON.stringify(spot));
    else storage.delete(PARKING_KEY);
  } catch {
    // Best effort — parking spot is non-critical.
  }
}

interface ParkingState {
  spot: ParkingSpot | null;
  isSaving: boolean;
  /** Save the current GPS location as the parking spot. */
  saveCurrentLocation: () => Promise<void>;
  /** Save an explicit coordinate (e.g. long-press). */
  saveSpot: (lat: number, lng: number, label?: string) => void;
  clearSpot: () => void;
}

export const useParkingStore = create<ParkingState>()((set) => ({
  spot: loadSpot(),
  isSaving: false,
  saveCurrentLocation: async () => {
    set({ isSaving: true });
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const spot: ParkingSpot = {
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
        savedAt: Date.now(),
      };
      persist(spot);
      set({ spot });
    } finally {
      set({ isSaving: false });
    }
  },
  saveSpot: (lat, lng, label) => {
    const spot: ParkingSpot = { lat, lng, savedAt: Date.now(), label };
    persist(spot);
    set({ spot });
  },
  clearSpot: () => {
    persist(null);
    set({ spot: null });
  },
}));
