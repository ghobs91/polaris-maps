import { create } from 'zustand';

interface DashCamState {
  /** The user asked the dash cam to run; the camera host does the recording. */
  recording: boolean;
  /** Epoch ms of the first clip in the current run. */
  startedAt: number | null;
  /** Segments written during this run. */
  clipCount: number;
  /** Bytes written during this run (all-time totals live in the DB). */
  bytes: number;
  /** Recording suspended because the app is not in the foreground. */
  paused: boolean;
  error: string | null;
  start: () => void;
  stop: () => void;
  recordClip: (bytes: number) => void;
  setPaused: (paused: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

const INITIAL = {
  recording: false,
  startedAt: null as number | null,
  clipCount: 0,
  bytes: 0,
  paused: false,
  error: null as string | null,
};

export const useDashCamStore = create<DashCamState>()((set) => ({
  ...INITIAL,
  start: () =>
    set({
      recording: true,
      startedAt: Date.now(),
      clipCount: 0,
      bytes: 0,
      paused: false,
      error: null,
    }),
  stop: () => set({ recording: false, paused: false }),
  recordClip: (bytes) =>
    set((state) => ({
      clipCount: state.clipCount + 1,
      bytes: state.bytes + bytes,
      error: null,
    })),
  setPaused: (paused) => set({ paused }),
  setError: (error) => set({ error }),
  reset: () => set({ ...INITIAL }),
}));

/** True while the dash cam is actively writing frames. */
export function isDashCamActive(): boolean {
  return useDashCamStore.getState().recording;
}

/** Reads the current run's elapsed seconds without subscribing. */
export function dashCamElapsedSeconds(): number {
  const { recording, startedAt } = useDashCamStore.getState();
  if (!recording || !startedAt) return 0;
  return Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
}
