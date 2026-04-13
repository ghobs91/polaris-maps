/**
 * Persistent OSM authentication state.
 *
 * Access token is stored in expo-secure-store so it survives app restarts.
 * The store rehydrates on first access.
 */
import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import {
  loginWithOsm,
  fetchOsmUserDetails,
  validateToken,
  type OsmAuthResult,
  type OsmUser,
} from '../services/osm/osmAuthService';

const TOKEN_KEY = 'osm_access_token';

interface OsmAuthState {
  /** Whether we've loaded the persisted token yet. */
  hydrated: boolean;
  /** The current access token, or null if not logged in. */
  accessToken: string | null;
  /** Cached user profile. */
  user: OsmUser | null;
  /** Whether a login/token-exchange is in progress. */
  isLoggingIn: boolean;

  /** Load token from secure storage on app start. */
  hydrate: () => Promise<void>;
  /** Full login flow: open browser → get token → fetch user. */
  login: () => Promise<void>;
  /** Remove token and forget user. */
  logout: () => Promise<void>;
  /** Check if the stored token is still valid; logout if not. */
  ensureValid: () => Promise<boolean>;
}

export const useOsmAuthStore = create<OsmAuthState>((set, get) => ({
  hydrated: false,
  accessToken: null,
  user: null,
  isLoggingIn: false,

  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const token = await SecureStore.getItemAsync(TOKEN_KEY);
      if (token) {
        set({ accessToken: token, hydrated: true });
        // Fetch user profile in background
        fetchOsmUserDetails(token)
          .then((user) => set({ user }))
          .catch(() => {
            /* best-effort; user will re-login if needed */
          });
      } else {
        set({ hydrated: true });
      }
    } catch {
      set({ hydrated: true });
    }
  },

  login: async () => {
    set({ isLoggingIn: true });
    try {
      const result: OsmAuthResult = await loginWithOsm();
      await SecureStore.setItemAsync(TOKEN_KEY, result.accessToken);
      set({ accessToken: result.accessToken });
      const user = await fetchOsmUserDetails(result.accessToken);
      set({ user, isLoggingIn: false });
    } catch (e) {
      set({ isLoggingIn: false });
      throw e;
    }
  },

  logout: async () => {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    set({ accessToken: null, user: null });
  },

  ensureValid: async () => {
    const { accessToken } = get();
    if (!accessToken) return false;
    const valid = await validateToken(accessToken);
    if (!valid) {
      await get().logout();
      return false;
    }
    return true;
  },
}));
