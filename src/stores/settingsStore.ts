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

export interface RoutePreferences {
  avoidTolls: boolean;
  avoidHighways: boolean;
  avoidFerries: boolean;
}

export type ThemeMode = 'system' | 'light' | 'dark';

interface SettingsState {
  resourceLimits: ResourceLimits;
  permissions: PermissionPreferences;
  routePreferences: RoutePreferences;
  themeMode: ThemeMode;
  /** When true, display speeds in km/h instead of mph. Default: false (mph). */
  useMetric: boolean;
  /** When true, speak turn-by-turn instructions during active navigation. Default: true. */
  voiceGuidanceEnabled: boolean;
  setResourceLimits: (limits: Partial<ResourceLimits>) => void;
  setPermissions: (prefs: Partial<PermissionPreferences>) => void;
  setRoutePreferences: (prefs: Partial<RoutePreferences>) => void;
  setThemeMode: (mode: ThemeMode) => void;
  setUseMetric: (metric: boolean) => void;
  setVoiceGuidanceEnabled: (enabled: boolean) => void;
}

const STORAGE_KEY = 'settings';

function loadSettings(): {
  resourceLimits: ResourceLimits;
  permissions: PermissionPreferences;
  routePreferences: RoutePreferences;
  themeMode: ThemeMode;
  useMetric: boolean;
  voiceGuidanceEnabled: boolean;
} {
  const raw = storage.getString(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      return {
        useMetric: false,
        voiceGuidanceEnabled: true,
        routePreferences: { avoidTolls: false, avoidHighways: false, avoidFerries: false },
        ...parsed,
      };
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
    routePreferences: {
      avoidTolls: false,
      avoidHighways: false,
      avoidFerries: false,
    },
    themeMode: 'system',
    useMetric: false,
    voiceGuidanceEnabled: true,
  };
}

function persistSettings(state: {
  resourceLimits: ResourceLimits;
  permissions: PermissionPreferences;
  routePreferences: RoutePreferences;
  themeMode: ThemeMode;
  useMetric: boolean;
  voiceGuidanceEnabled: boolean;
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
        routePreferences: get().routePreferences,
        themeMode: get().themeMode,
        useMetric: get().useMetric,
        voiceGuidanceEnabled: get().voiceGuidanceEnabled,
      });
    },
    setPermissions: (prefs) => {
      const updated = { ...get().permissions, ...prefs };
      set({ permissions: updated });
      persistSettings({
        resourceLimits: get().resourceLimits,
        permissions: updated,
        routePreferences: get().routePreferences,
        themeMode: get().themeMode,
        useMetric: get().useMetric,
        voiceGuidanceEnabled: get().voiceGuidanceEnabled,
      });
    },
    setRoutePreferences: (prefs) => {
      const updated = { ...get().routePreferences, ...prefs };
      set({ routePreferences: updated });
      persistSettings({
        resourceLimits: get().resourceLimits,
        permissions: get().permissions,
        routePreferences: updated,
        themeMode: get().themeMode,
        useMetric: get().useMetric,
        voiceGuidanceEnabled: get().voiceGuidanceEnabled,
      });
    },
    setThemeMode: (mode) => {
      set({ themeMode: mode });
      persistSettings({
        resourceLimits: get().resourceLimits,
        permissions: get().permissions,
        routePreferences: get().routePreferences,
        themeMode: mode,
        useMetric: get().useMetric,
        voiceGuidanceEnabled: get().voiceGuidanceEnabled,
      });
    },
    setUseMetric: (useMetric) => {
      set({ useMetric });
      persistSettings({
        resourceLimits: get().resourceLimits,
        permissions: get().permissions,
        routePreferences: get().routePreferences,
        themeMode: get().themeMode,
        useMetric,
        voiceGuidanceEnabled: get().voiceGuidanceEnabled,
      });
    },
    setVoiceGuidanceEnabled: (voiceGuidanceEnabled) => {
      set({ voiceGuidanceEnabled });
      persistSettings({
        resourceLimits: get().resourceLimits,
        permissions: get().permissions,
        routePreferences: get().routePreferences,
        themeMode: get().themeMode,
        useMetric: get().useMetric,
        voiceGuidanceEnabled,
      });
    },
  };
});
