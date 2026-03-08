import { create } from 'zustand';
import { storage } from '../services/storage/mmkv';

interface ResourceLimits {
  maxStorageMb: number;
  maxBandwidthMbps: number;
  maxBatteryPctHr: number;
}

interface PermissionPreferences {
  locationEnabled: boolean;
  trafficTelemetryEnabled: boolean;
  poiContributionsEnabled: boolean;
  imagerySharingEnabled: boolean;
}

export type ThemeMode = 'system' | 'light' | 'dark';

interface SettingsState {
  resourceLimits: ResourceLimits;
  permissions: PermissionPreferences;
  themeMode: ThemeMode;
  setResourceLimits: (limits: Partial<ResourceLimits>) => void;
  setPermissions: (prefs: Partial<PermissionPreferences>) => void;
  setThemeMode: (mode: ThemeMode) => void;
}

const STORAGE_KEY = 'settings';

function loadSettings(): {
  resourceLimits: ResourceLimits;
  permissions: PermissionPreferences;
  themeMode: ThemeMode;
} {
  const raw = storage.getString(STORAGE_KEY);
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {
      // ignore corrupt data
    }
  }
  return {
    resourceLimits: {
      maxStorageMb: 2048,
      maxBandwidthMbps: 10,
      maxBatteryPctHr: 5,
    },
    permissions: {
      locationEnabled: true,
      trafficTelemetryEnabled: true,
      poiContributionsEnabled: true,
      imagerySharingEnabled: false,
    },
    themeMode: 'system',
  };
}

function persistSettings(state: {
  resourceLimits: ResourceLimits;
  permissions: PermissionPreferences;
  themeMode: ThemeMode;
}) {
  storage.set(STORAGE_KEY, JSON.stringify(state));
}

export const useSettingsStore = create<SettingsState>()((set, get) => {
  const initial = loadSettings();
  return {
    ...initial,
    setResourceLimits: (limits) => {
      const updated = { ...get().resourceLimits, ...limits };
      set({ resourceLimits: updated });
      persistSettings({
        resourceLimits: updated,
        permissions: get().permissions,
        themeMode: get().themeMode,
      });
    },
    setPermissions: (prefs) => {
      const updated = { ...get().permissions, ...prefs };
      set({ permissions: updated });
      persistSettings({
        resourceLimits: get().resourceLimits,
        permissions: updated,
        themeMode: get().themeMode,
      });
    },
    setThemeMode: (mode) => {
      set({ themeMode: mode });
      persistSettings({
        resourceLimits: get().resourceLimits,
        permissions: get().permissions,
        themeMode: mode,
      });
    },
  };
});
