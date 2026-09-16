import { create } from 'zustand';
import { storage } from '../services/storage/mmkv';

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

interface PersistedSettings {
  permissions: PermissionPreferences;
  routePreferences: RoutePreferences;
  themeMode: ThemeMode;
  useMetric: boolean;
  voiceGuidanceEnabled: boolean;
  /** Automatically advance to the next waypoint leg on arrival. */
  navigationAutoAdvanceLegs: boolean;
  /** Automatically end navigation shortly after reaching the destination. */
  navigationAutoEnd: boolean;
}

interface SettingsState extends PersistedSettings {
  setPermissions: (prefs: Partial<PermissionPreferences>) => void;
  setRoutePreferences: (prefs: Partial<RoutePreferences>) => void;
  setThemeMode: (mode: ThemeMode) => void;
  setUseMetric: (metric: boolean) => void;
  setVoiceGuidanceEnabled: (enabled: boolean) => void;
  setNavigationAutoAdvanceLegs: (enabled: boolean) => void;
  setNavigationAutoEnd: (enabled: boolean) => void;
}

const STORAGE_KEY = 'settings';

const DEFAULT_SETTINGS: PersistedSettings = {
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
  navigationAutoAdvanceLegs: true,
  navigationAutoEnd: true,
};

function loadSettings(): PersistedSettings {
  const raw = storage.getString(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<PersistedSettings>;
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        permissions: { ...DEFAULT_SETTINGS.permissions, ...(parsed.permissions ?? {}) },
        routePreferences: {
          ...DEFAULT_SETTINGS.routePreferences,
          ...(parsed.routePreferences ?? {}),
        },
      };
    } catch {
      // ignore corrupt data
    }
  }
  return { ...DEFAULT_SETTINGS };
}

export const useSettingsStore = create<SettingsState>()((set, get) => {
  const persist = () => {
    const state = get();
    const payload: PersistedSettings = {
      permissions: state.permissions,
      routePreferences: state.routePreferences,
      themeMode: state.themeMode,
      useMetric: state.useMetric,
      voiceGuidanceEnabled: state.voiceGuidanceEnabled,
      navigationAutoAdvanceLegs: state.navigationAutoAdvanceLegs,
      navigationAutoEnd: state.navigationAutoEnd,
    };
    storage.set(STORAGE_KEY, JSON.stringify(payload));
  };

  return {
    ...loadSettings(),
    setPermissions: (prefs) => {
      set({ permissions: { ...get().permissions, ...prefs } });
      persist();
    },
    setRoutePreferences: (prefs) => {
      set({ routePreferences: { ...get().routePreferences, ...prefs } });
      persist();
    },
    setThemeMode: (themeMode) => {
      set({ themeMode });
      persist();
    },
    setUseMetric: (useMetric) => {
      set({ useMetric });
      persist();
    },
    setVoiceGuidanceEnabled: (voiceGuidanceEnabled) => {
      set({ voiceGuidanceEnabled });
      persist();
    },
    setNavigationAutoAdvanceLegs: (navigationAutoAdvanceLegs) => {
      set({ navigationAutoAdvanceLegs });
      persist();
    },
    setNavigationAutoEnd: (navigationAutoEnd) => {
      set({ navigationAutoEnd });
      persist();
    },
  };
});
