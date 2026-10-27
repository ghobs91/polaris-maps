import { create } from 'zustand';
import { storage } from '../services/storage/mmkv';

interface PermissionPreferences {
  locationEnabled: boolean;
  trafficTelemetryEnabled: boolean;
  poiContributionsEnabled: boolean;
  imagerySharingEnabled: boolean;
  /** Opt-in: publish review photos to peers by content hash. */
  reviewPhotoSharingEnabled: boolean;
}

export interface RoutePreferences {
  avoidTolls: boolean;
  avoidHighways: boolean;
  avoidFerries: boolean;
}

export type ThemeMode = 'system' | 'light' | 'dark';

/** Sort order for the places inside a saved list. */
export type PlaceSortMode = 'recent' | 'name' | 'distance';
/** Sort order for the saved-lists screen. */
export type SavedListsSortMode = 'recent' | 'name';

export type StreetViewCaptureModePreference = 'standard' | 'threeD';

export interface StreetViewPreferences {
  /** Master opt-in for contributing street imagery during navigation. */
  enabled: boolean;
  /** One-time explainer accepted. */
  consentAccepted: boolean;
  /** Start a capture session automatically on driving routes. */
  autoStart: boolean;
  /** The first-run auto-start question has been answered. */
  autoStartPromptAnswered: boolean;
  mode: StreetViewCaptureModePreference;
  /** Default to Wi-Fi for uploads. */
  wifiOnly: boolean;
  /** Reserved for automatic end-of-drive upload (MVP uses the confirmation sheet). */
  autoUpload: boolean;
  maxStorageBytes: number;
  mapillaryUsername: string | null;
}

/**
 * Rolling dash-cam buffer. Recording is always explicit (the user taps the
 * dash-cam action); these values bound how much footage is kept on disk.
 */
export interface DashCamPreferences {
  /** Show and allow the dash-cam action. */
  enabled: boolean;
  /** Length of one continuous clip before it rolls over to a new file. */
  clipSeconds: number;
  /** Rolling window of footage to keep. */
  maxMinutes: number;
  /** Hard disk budget; whichever cap is hit first drops the oldest clips. */
  maxBytes: number;
}

interface PersistedSettings {
  permissions: PermissionPreferences;
  routePreferences: RoutePreferences;
  streetView: StreetViewPreferences;
  dashCam: DashCamPreferences;
  themeMode: ThemeMode;
  useMetric: boolean;
  voiceGuidanceEnabled: boolean;
  /** Automatically advance to the next waypoint leg on arrival. */
  navigationAutoAdvanceLegs: boolean;
  /** Automatically end navigation shortly after reaching the destination. */
  navigationAutoEnd: boolean;
  /** Default "most recently added" sort for places within a list. */
  placeSort: PlaceSortMode;
  /** Default "most recently updated" sort for the saved-lists screen. */
  savedListsSort: SavedListsSortMode;
  /** Developer tool: replay onboarding on the next cold start. */
  showOnboardingOnLaunch: boolean;
}

interface SettingsState extends PersistedSettings {
  setPermissions: (prefs: Partial<PermissionPreferences>) => void;
  setRoutePreferences: (prefs: Partial<RoutePreferences>) => void;
  setStreetView: (prefs: Partial<StreetViewPreferences>) => void;
  setDashCam: (prefs: Partial<DashCamPreferences>) => void;
  setThemeMode: (mode: ThemeMode) => void;
  setUseMetric: (metric: boolean) => void;
  setVoiceGuidanceEnabled: (enabled: boolean) => void;
  setNavigationAutoAdvanceLegs: (enabled: boolean) => void;
  setNavigationAutoEnd: (enabled: boolean) => void;
  setPlaceSort: (mode: PlaceSortMode) => void;
  setSavedListsSort: (mode: SavedListsSortMode) => void;
  setShowOnboardingOnLaunch: (enabled: boolean) => void;
}

const STORAGE_KEY = 'settings';

const DEFAULT_SETTINGS: PersistedSettings = {
  permissions: {
    locationEnabled: true,
    trafficTelemetryEnabled: true,
    poiContributionsEnabled: true,
    imagerySharingEnabled: true,
    reviewPhotoSharingEnabled: false,
  },
  routePreferences: {
    avoidTolls: false,
    avoidHighways: false,
    avoidFerries: false,
  },
  streetView: {
    enabled: false,
    consentAccepted: false,
    autoStart: false,
    autoStartPromptAnswered: false,
    mode: 'standard',
    wifiOnly: true,
    autoUpload: false,
    maxStorageBytes: 2 * 1024 * 1024 * 1024,
    mapillaryUsername: null,
  },
  dashCam: {
    enabled: true,
    clipSeconds: 60,
    maxMinutes: 60,
    maxBytes: 2 * 1024 * 1024 * 1024,
  },
  themeMode: 'system',
  useMetric: false,
  voiceGuidanceEnabled: true,
  navigationAutoAdvanceLegs: true,
  navigationAutoEnd: true,
  placeSort: 'recent',
  savedListsSort: 'recent',
  showOnboardingOnLaunch: false,
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
        streetView: {
          ...DEFAULT_SETTINGS.streetView,
          ...(parsed.streetView ?? {}),
        },
        dashCam: {
          ...DEFAULT_SETTINGS.dashCam,
          ...(parsed.dashCam ?? {}),
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
      streetView: state.streetView,
      dashCam: state.dashCam,
      themeMode: state.themeMode,
      useMetric: state.useMetric,
      voiceGuidanceEnabled: state.voiceGuidanceEnabled,
      navigationAutoAdvanceLegs: state.navigationAutoAdvanceLegs,
      navigationAutoEnd: state.navigationAutoEnd,
      placeSort: state.placeSort,
      savedListsSort: state.savedListsSort,
      showOnboardingOnLaunch: state.showOnboardingOnLaunch,
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
    setStreetView: (prefs) => {
      set({ streetView: { ...get().streetView, ...prefs } });
      persist();
    },
    setDashCam: (prefs) => {
      set({ dashCam: { ...get().dashCam, ...prefs } });
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
    setPlaceSort: (placeSort) => {
      set({ placeSort });
      persist();
    },
    setSavedListsSort: (savedListsSort) => {
      set({ savedListsSort });
      persist();
    },
    setShowOnboardingOnLaunch: (showOnboardingOnLaunch) => {
      set({ showOnboardingOnLaunch });
      persist();
    },
  };
});
