import { create } from 'zustand';
import { storage } from '../services/storage/mmkv';
import {
  cancelReviewImport,
  getReviewImportSnapshot,
  startReviewImport,
  subscribeReviewImport,
  type ReviewImportProgress,
  type ReviewImportStatus,
} from '../services/reviews/reviewImportQueue';
import type { ParsedGoogleReview } from '../services/reviews/googleReviewsImport';

/**
 * UI state for the Google-reviews import plus the Takeout 24h reminder.
 *
 * The reminder is deliberately in-app only (no push dependency): when the
 * user asks to be reminded, we persist a due timestamp; surfaces whose job
 * it is to nudge (onboarding completion, My Places) check `isTakeoutReminderDue()`.
 */

const REMINDER_KEY = 'takeout_reminder_at';
export const TAKEOUT_REMINDER_DELAY_MS = 24 * 60 * 60 * 1000;

interface ReviewImportState {
  status: ReviewImportStatus;
  progress: ReviewImportProgress;
  error: string | null;
  /** Parsed reviews awaiting import (set by the file picker, consumed by start). */
  pending: ParsedGoogleReview[];
  setPending: (reviews: ParsedGoogleReview[]) => void;
  start: () => Promise<void>;
  cancel: () => void;
  reset: () => void;

  /** Epoch-ms when the Takeout reminder becomes due, or null when unset. */
  takeoutReminderAt: number | null;
  /** Schedule the "your Takeout is probably ready" nudge for 24h from now. */
  snoozeTakeoutReminder: () => void;
  /** Clear the reminder (user imported, or dismissed it). */
  clearTakeoutReminder: () => void;
}

function loadReminder(): number | null {
  const raw = storage.getString(REMINDER_KEY);
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

let subscribed = false;

export const useReviewImportStore = create<ReviewImportState>((set, get) => ({
  ...getReviewImportSnapshot(),
  error: null,
  pending: [],
  takeoutReminderAt: loadReminder(),

  setPending: (reviews) => set({ pending: reviews, error: null }),

  start: async () => {
    const { pending } = get();
    if (pending.length === 0) return;
    set({ error: null });
    ensureSubscribed();
    try {
      await startReviewImport(pending);
      set({ pending: [] });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Import failed' });
    }
  },

  cancel: () => {
    cancelReviewImport();
  },

  reset: () => {
    cancelReviewImport();
    set({ ...getReviewImportSnapshot(), status: 'idle', error: null, pending: [] });
  },

  snoozeTakeoutReminder: () => {
    const at = Date.now() + TAKEOUT_REMINDER_DELAY_MS;
    storage.set(REMINDER_KEY, String(at));
    set({ takeoutReminderAt: at });
  },

  clearTakeoutReminder: () => {
    storage.delete(REMINDER_KEY);
    set({ takeoutReminderAt: null });
  },
}));

function ensureSubscribed(): void {
  if (subscribed) return;
  subscribed = true;
  subscribeReviewImport(({ status, progress }) => {
    useReviewImportStore.setState({ status, progress });
  });
}

/** True when a reminder was scheduled and its 24h have elapsed. */
export function isTakeoutReminderDue(reminderAt: number | null): boolean {
  return reminderAt !== null && Date.now() >= reminderAt;
}
