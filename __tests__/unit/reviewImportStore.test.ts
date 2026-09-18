/**
 * Tests for the Takeout reminder helpers in the review import store.
 * Uses a mock MMKV to isolate from real storage.
 */

jest.mock('../../src/services/storage/mmkv', () => {
  const store = new Map<string, string>();
  return {
    storage: {
      getString: (key: string) => store.get(key),
      set: (key: string, value: string) => store.set(key, value),
      delete: (key: string) => store.delete(key),
    },
    _testClear: () => store.clear(),
  };
});

// Stub the import queue: it pulls the Bluesky OAuth client (ESM), which the
// Jest transform cannot parse. Reminder logic doesn't touch the queue.
jest.mock('../../src/services/reviews/reviewImportQueue', () => ({
  cancelReviewImport: jest.fn(),
  getReviewImportSnapshot: () => ({
    status: 'idle',
    progress: { total: 0, completed: 0, imported: 0, unmatched: [], failed: [] },
  }),
  startReviewImport: jest.fn(),
  subscribeReviewImport: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { _testClear } = require('../../src/services/storage/mmkv') as {
  _testClear: () => void;
};

import {
  isTakeoutReminderDue,
  TAKEOUT_REMINDER_DELAY_MS,
  useReviewImportStore,
} from '../../src/stores/reviewImportStore';

beforeEach(() => {
  _testClear();
  useReviewImportStore.setState({ takeoutReminderAt: null });
});

describe('isTakeoutReminderDue', () => {
  it('is not due when unset', () => {
    expect(isTakeoutReminderDue(null)).toBe(false);
  });

  it('is not due before 24h elapse', () => {
    expect(isTakeoutReminderDue(Date.now() + 60_000)).toBe(false);
  });

  it('is due after the scheduled time passes', () => {
    expect(isTakeoutReminderDue(Date.now() - 1_000)).toBe(true);
  });
});

describe('takeout reminder scheduling', () => {
  it('snoozes ~24h into the future and is not immediately due', () => {
    const before = Date.now();
    useReviewImportStore.getState().snoozeTakeoutReminder();
    const at = useReviewImportStore.getState().takeoutReminderAt;
    expect(at).not.toBeNull();
    expect(at! - before).toBeGreaterThan(TAKEOUT_REMINDER_DELAY_MS - 5_000);
    expect(isTakeoutReminderDue(at)).toBe(false);
  });

  it('clears the reminder', () => {
    useReviewImportStore.getState().snoozeTakeoutReminder();
    useReviewImportStore.getState().clearTakeoutReminder();
    expect(useReviewImportStore.getState().takeoutReminderAt).toBeNull();
  });
});
