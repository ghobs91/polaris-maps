import { create } from 'zustand';

export interface StreetViewUploadState {
  driveId: string | null;
  status: 'idle' | 'preparing' | 'uploading' | 'complete' | 'failed';
  uploaded: number;
  failed: number;
  total: number;
  error: string | null;

  start: (driveId: string, total: number) => void;
  progress: (uploaded: number, failed: number, total: number) => void;
  finish: (error?: string | null) => void;
  reset: () => void;
}

const initial = {
  driveId: null as string | null,
  status: 'idle' as const,
  uploaded: 0,
  failed: 0,
  total: 0,
  error: null as string | null,
};

export const useStreetViewUploadStore = create<StreetViewUploadState>()((set) => ({
  ...initial,
  start: (driveId, total) =>
    set({
      driveId,
      status: 'uploading',
      uploaded: 0,
      failed: 0,
      total,
      error: null,
    }),
  progress: (uploaded, failed, total) => set({ status: 'uploading', uploaded, failed, total }),
  finish: (error = null) =>
    set((state) => ({
      status: error ? 'failed' : 'complete',
      error,
      uploaded: state.uploaded,
      failed: state.failed,
      total: state.total,
    })),
  reset: () => set({ ...initial }),
}));
