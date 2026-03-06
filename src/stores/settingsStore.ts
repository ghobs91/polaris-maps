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

interface SettingsState {
  resourceLimits: ResourceLimits;
  permissions: PermissionPreferences;
  setResourceLimits: (limits: Partial<ResourceLimits>) => void;
  setPermissions: (prefs: Partial<PermissionPreferences>) => void;
}

const STORAGE_KEY = 'settings';

function loadSettings(): { resourceLimits: ResourceLimits; permissions: PermissionPreferences } {
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
  };
}

function persistSettings(state: {
  resourceLimits: ResourceLimits;
  permissions: PermissionPreferences;
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
      persistSettings({ resourceLimits: updated, permissions: get().permissions });
    },
    setPermissions: (prefs) => {
      const updated = { ...get().permissions, ...prefs };
      set({ permissions: updated });
      persistSettings({ resourceLimits: get().resourceLimits, permissions: updated });
    },
  };
});
