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
  /** When true, display speeds in km/h instead of mph. Default: false (mph). */
  useMetric: boolean;
  setResourceLimits: (limits: Partial<ResourceLimits>) => void;
  setPermissions: (prefs: Partial<PermissionPreferences>) => void;
  setThemeMode: (mode: ThemeMode) => void;
  setUseMetric: (metric: boolean) => void;
}

const STORAGE_KEY = 'settings';

function loadSettings(): {
  resourceLimits: ResourceLimits;
  permissions: PermissionPreferences;
  themeMode: ThemeMode;
  useMetric: boolean;
} {
  const raw = storage.getString(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      return { useMetric: false, ...parsed };
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
    useMetric: false,
  };
}

function persistSettings(state: {
  resourceLimits: ResourceLimits;
  permissions: PermissionPreferences;
  themeMode: ThemeMode;
  useMetric: boolean;
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
        useMetric: get().useMetric,
      });
    },
    setPermissions: (prefs) => {
      const updated = { ...get().permissions, ...prefs };
      set({ permissions: updated });
      persistSettings({
        resourceLimits: get().resourceLimits,
        permissions: updated,
        themeMode: get().themeMode,
        useMetric: get().useMetric,
      });
    },
    setThemeMode: (mode) => {
      set({ themeMode: mode });
      persistSettings({
        resourceLimits: get().resourceLimits,
        permissions: get().permissions,
        themeMode: mode,
        useMetric: get().useMetric,
      });
    },
    setUseMetric: (useMetric) => {
      set({ useMetric });
      persistSettings({
        resourceLimits: get().resourceLimits,
        permissions: get().permissions,
        themeMode: get().themeMode,
        useMetric,
      });
    },
  };
});
