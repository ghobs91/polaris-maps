import { create } from 'zustand';
import {
  loginWithBluesky,
  logoutBluesky,
  getBlueskySession,
  restoreBlueskySession,
  AuthError,
  type AtprotoSession,
} from '../services/atproto/atprotoAuthService';

interface AtprotoAuthState {
  session: AtprotoSession | null;
  isLoading: boolean;
  error: string | null;
  /** Start the OAuth login flow for the given Bluesky handle. */
  login: (handle: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Re-establish a previously-saved session on app start. */
  restore: () => Promise<void>;
}

export const useAtprotoAuthStore = create<AtprotoAuthState>((set) => ({
  session: null,
  isLoading: false,
  error: null,

  login: async (handle: string) => {
    set({ isLoading: true, error: null });
    try {
      await loginWithBluesky(handle);
      const session = await getBlueskySession();
      set({ session, isLoading: false });
    } catch (err) {
      const message = err instanceof AuthError ? err.message : 'Login failed';
      set({ error: message, isLoading: false });
    }
  },

  logout: async () => {
    await logoutBluesky();
    set({ session: null, error: null });
  },

  restore: async () => {
    try {
      const session = await restoreBlueskySession();
      set({ session });
    } catch {
      set({ session: null });
    }
  },
}));
