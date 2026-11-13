/**
 * Timetable asset: pure time/bounds helpers and the region registry.
 *
 * The SQLite queries themselves are exercised end-to-end by the pack build; what
 * matters here is the service-day arithmetic (a wrong weekday bit silently
 * returns no trips) and the coverage/window decisions.
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
  TRANSIT_TIMETABLE_SCHEMA_VERSION,
  dayBit,
  findTimetableFor,
  haversineMeters,
  readTimetableRegistry,
  registerTimetable,
  secondsSinceMidnight,
  serviceDayFor,
  timetableStateFor,
  unregisterTimetable,
  yyyymmdd,
  type TimetableMeta,
  type TimetableRegistration,
} from '../../src/services/transit/transitTimetable';

beforeEach(() => mockStorage.clear());

describe('dayBit', () => {
  it('uses Monday-based bits, matching GTFS calendar.txt', () => {
    // 2026-05-04 is a Monday.
    const monday = new Date(2026, 4, 4);
    expect(dayBit(monday)).toBe(1);
    expect(dayBit(new Date(2026, 4, 5))).toBe(2); // Tuesday
    expect(dayBit(new Date(2026, 4, 9))).toBe(32); // Saturday
    expect(dayBit(new Date(2026, 4, 10))).toBe(64); // Sunday
  });

  it('is stable across a week of distinct values', () => {
    const bits = new Set<number>();
    for (let d = 0; d < 7; d++) bits.add(dayBit(new Date(2026, 4, 4 + d)));
    expect(bits.size).toBe(7);
  });
});

describe('date helpers', () => {
  it('formats YYYYMMDD', () => {
    expect(yyyymmdd(new Date(2026, 0, 5))).toBe(20260105);
    expect(yyyymmdd(new Date(2026, 11, 31))).toBe(20261231);
  });

  it('counts seconds since local midnight', () => {
    expect(secondsSinceMidnight(new Date(2026, 4, 4, 0, 0, 0))).toBe(0);
    expect(secondsSinceMidnight(new Date(2026, 4, 4, 8, 30, 15))).toBe(8 * 3600 + 30 * 60 + 15);
  });

  it('truncates to the local service day', () => {
    const day = serviceDayFor(new Date(2026, 4, 4, 23, 59, 59));
    expect(day.getHours()).toBe(0);
    expect(day.getMinutes()).toBe(0);
    expect(day.getDate()).toBe(4);
  });
});

describe('timetableStateFor', () => {
  const meta: TimetableMeta = {
    schemaVersion: TRANSIT_TIMETABLE_SCHEMA_VERSION,
    feedVersion: 'v1',
    serviceStart: 20260501,
    serviceEnd: 20260601,
    connectionCount: 100,
  };

  it('is absent without metadata', () => {
    expect(timetableStateFor(null, new Date(2026, 4, 4))).toBe('absent');
  });

  it('is absent when the feed declares no service window', () => {
    expect(
      timetableStateFor({ ...meta, serviceStart: 0, serviceEnd: 0 }, new Date(2026, 4, 4)),
    ).toBe('absent');
  });

  it('is usable inside the service window', () => {
    expect(timetableStateFor(meta, new Date(2026, 4, 4))).toBe('usable');
    expect(timetableStateFor(meta, new Date(2026, 4, 1))).toBe('usable');
    expect(timetableStateFor(meta, new Date(2026, 5, 1))).toBe('usable');
  });

  it('is expired outside the service window', () => {
    expect(timetableStateFor(meta, new Date(2026, 3, 30))).toBe('expired');
    expect(timetableStateFor(meta, new Date(2026, 5, 2))).toBe('expired');
  });
});

describe('registry', () => {
  const entry: TimetableRegistration = {
    regionId: 'us-il-chicago',
    path: '/packs/chicago/transit-timetable.sqlite',
    bounds: { south: 41.6, west: -87.9, north: 42.1, east: -87.5 },
    installedAt: 1,
  };

  it('starts empty', () => {
    expect(readTimetableRegistry()).toEqual([]);
  });

  it('round-trips a registration', () => {
    registerTimetable(entry);
    expect(readTimetableRegistry()).toEqual([entry]);
  });

  it('replaces a region rather than duplicating it', () => {
    registerTimetable(entry);
    registerTimetable({ ...entry, path: '/packs/chicago/transit-timetable-v2.sqlite' });
    expect(readTimetableRegistry()).toHaveLength(1);
    expect(readTimetableRegistry()[0].path).toContain('v2');
  });

  it('forgets a region on unregister', () => {
    registerTimetable(entry);
    unregisterTimetable(entry.regionId);
    expect(readTimetableRegistry()).toEqual([]);
  });

  it('survives a corrupt registry payload', () => {
    mockStorage.set('transit.timetable.registry.v1', '{not json');
    expect(readTimetableRegistry()).toEqual([]);
  });
});

describe('findTimetableFor', () => {
  const registry: TimetableRegistration[] = [
    {
      regionId: 'a',
      path: '/a.sqlite',
      bounds: { south: 0, west: 0, north: 10, east: 10 },
      installedAt: 1,
    },
    {
      regionId: 'b',
      path: '/b.sqlite',
      bounds: { south: 20, west: 20, north: 30, east: 30 },
      installedAt: 1,
    },
  ];

  it('finds the pack containing a point', () => {
    expect(findTimetableFor(5, 5, registry)?.regionId).toBe('a');
    expect(findTimetableFor(25, 25, registry)?.regionId).toBe('b');
  });

  it('returns null outside every pack', () => {
    expect(findTimetableFor(15, 15, registry)).toBeNull();
  });

  it('includes points on the boundary', () => {
    expect(findTimetableFor(0, 0, registry)?.regionId).toBe('a');
  });
});

describe('haversineMeters', () => {
  it('is zero for identical points', () => {
    expect(haversineMeters(41.88, -87.63, 41.88, -87.63)).toBe(0);
  });

  it('measures a known short distance', () => {
    // ~1.11 km per 0.01 degrees of latitude.
    const metres = haversineMeters(41.88, -87.63, 41.89, -87.63);
    expect(metres).toBeGreaterThan(1_100);
    expect(metres).toBeLessThan(1_120);
  });
});
