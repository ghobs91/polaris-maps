import { create } from 'zustand';

export interface StreetViewSession {
  driveId: string;
  startedAt: number;
  startedBy: 'manual' | 'auto';
  captureCount: number;
  bytes: number;
  lastError: string | null;
}

interface StreetViewCaptureState {
  session: StreetViewSession | null;
  /** The drive whose end-of-drive summary should be shown. */
  pendingDriveId: string | null;

  startSession: (
    driveId: string,
    startedAt: number,
    startedBy: StreetViewSession['startedBy'],
  ) => void;
  recordCapture: (bytes: number) => void;
  setSessionError: (error: string | null) => void;
  finalizeSession: () => void;
  clearSession: () => void;
  setPendingDriveId: (driveId: string | null) => void;
}

export const useStreetViewCaptureStore = create<StreetViewCaptureState>()((set, get) => ({
  session: null,
  pendingDriveId: null,

  startSession: (driveId, startedAt, startedBy) =>
    set({
      session: {
        driveId,
        startedAt,
        startedBy,
        captureCount: 0,
        bytes: 0,
        lastError: null,
      },
    }),

  recordCapture: (bytes) => {
    const session = get().session;
    if (!session) return;
    set({
      session: {
        ...session,
        captureCount: session.captureCount + 1,
        bytes: session.bytes + Math.max(0, bytes),
        lastError: null,
      },
    });
  },

  setSessionError: (lastError) => {
    const session = get().session;
    if (!session) return;
    set({ session: { ...session, lastError } });
  },

  finalizeSession: () => {
    const session = get().session;
    if (!session) return;
    set({ session: null, pendingDriveId: session.driveId });
  },

  clearSession: () => set({ session: null }),
  setPendingDriveId: (pendingDriveId) => set({ pendingDriveId }),
}));
