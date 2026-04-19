import { create } from 'zustand';
import {
  loginWithBluesky,
  logoutBluesky,
  getBlueskySession,
  refreshBlueskySession,
  AuthError,
  type AtprotoSession,
} from '../services/atproto/atprotoAuthService';

interface AtprotoAuthState {
  session: AtprotoSession | null;
  isLoading: boolean;
  error: string | null;
  login: (handle: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  restore: () => Promise<void>;
}

export const useAtprotoAuthStore = create<AtprotoAuthState>((set) => ({
  session: null,
  isLoading: false,
  error: null,

  login: async (handle: string, password: string) => {
    set({ isLoading: true, error: null });
    try {
      await loginWithBluesky(handle, password);
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
    const stored = await getBlueskySession();
    if (!stored) return;
    set({ session: stored });
    try {
      await refreshBlueskySession();
      const refreshed = await getBlueskySession();
      set({ session: refreshed });
    } catch {
      set({ session: null });
    }
  },
}));
