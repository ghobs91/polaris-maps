/**
 * Local timetable planner — service-day selection.
 *
 * The database path is covered by the pack build; what is unit-testable without
 * SQLite is the service-day arithmetic, and that is the part that silently
 * returns no trips when it is wrong.
 */

jest.mock('expo-sqlite', () => ({}));

const mockStorage = new Map<string, string>();

jest.mock('../../src/services/storage/mmkv', () => ({
  getStorageSync: () => ({
    getString: (key: string) => mockStorage.get(key),
    set: (key: string, value: string) => mockStorage.set(key, value),
    delete: (key: string) => mockStorage.delete(key),
  }),
  storage: {
    getString: (key: string) => mockStorage.get(key),
    set: (key: string, value: string) => mockStorage.set(key, value),
    delete: (key: string) => mockStorage.delete(key),
  },
}));

jest.mock('../../src/services/diagnostics/diagnosticsLog', () => ({
  logDiagnostic: jest.fn(),
}));

import {
  OVERNIGHT_LOOKBACK_HOUR,
  serviceDaysFor,
} from '../../src/services/transit/transitTimetablePlanner';

beforeEach(() => mockStorage.clear());

describe('serviceDaysFor', () => {
  it('uses a single service day during the day', () => {
    const days = serviceDaysFor(new Date(2026, 4, 4, 12, 0, 0));
    expect(days).toHaveLength(1);
    expect(days[0].offsetS).toBe(0);
    expect(days[0].date.getDate()).toBe(4);
  });

  it('also looks at yesterday in the small hours', () => {
    // 01:00 is 25:00 of the previous service day; overnight trips are still running.
    const days = serviceDaysFor(new Date(2026, 4, 4, 1, 0, 0));
    expect(days).toHaveLength(2);
    expect(days[0].offsetS).toBe(86_400);
    expect(days[0].date.getDate()).toBe(3);
    expect(days[1].offsetS).toBe(0);
    expect(days[1].date.getDate()).toBe(4);
  });

  it('switches over exactly at the lookback hour', () => {
    const before = serviceDaysFor(new Date(2026, 4, 4, OVERNIGHT_LOOKBACK_HOUR - 1, 59));
    const at = serviceDaysFor(new Date(2026, 4, 4, OVERNIGHT_LOOKBACK_HOUR, 0));
    expect(before).toHaveLength(2);
    expect(at).toHaveLength(1);
  });

  it('handles the first day of a month', () => {
    const days = serviceDaysFor(new Date(2026, 5, 1, 2, 0, 0));
    expect(days[0].date.getMonth()).toBe(4); // May
    expect(days[0].date.getDate()).toBe(31);
  });

  it('returns the previous day first so results merge earliest-first', () => {
    const days = serviceDaysFor(new Date(2026, 4, 4, 2, 0, 0));
    expect(days[0].date.getTime()).toBeLessThan(days[1].date.getTime());
  });
});
