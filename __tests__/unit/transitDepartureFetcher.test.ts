/**
 * Unit tests for the transit departure fetcher.
 *
 * Tests OTP1 stoptimes integration and headway fallback logic
 * with mocked fetch responses and OTP endpoint registry.
 */

jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getString: jest.fn(),
    getBoolean: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
  })),
}));

// mbtaFetcher pulls expo virtual modules that Jest cannot transform
// (pre-existing); the suites under test never need real MBTA data.
jest.mock('../../src/services/transit/mbtaFetcher', () => ({
  isInMbtaArea: jest.fn().mockReturnValue(false),
  fetchMbtaDepartures: jest.fn(),
}));

import {
  fetchDepartures,
  shouldShowClockTime,
  buildTripStopList,
  formatTripStopStatus,
} from '../../src/services/transit/transitDepartureFetcher';
import * as mbtaFetcher from '../../src/services/transit/mbtaFetcher';
import * as otpRegistry from '../../src/services/transit/otpEndpointRegistry';

// ── Mocks ───────────────────────────────────────────────────────────

const findOtpStopIdsSpy = jest.spyOn(otpRegistry, 'findOtpStopIds');
const fetchOtp1StoptimesSpy = jest.spyOn(otpRegistry, 'fetchOtp1Stoptimes');
const fetchOtpRoutesAtStopSpy = jest.spyOn(otpRegistry, 'fetchOtpRoutesAtStop');

beforeEach(() => {
  jest.clearAllMocks();
  (mbtaFetcher.isInMbtaArea as jest.Mock).mockReturnValue(false);
});

// ── Helpers ───────────────────────────────────────────────────────────

function makeStoptime(
  headsign: string,
  minutesFromNow: number,
  opts: {
    realtime?: boolean;
    patternDesc?: string;
    patternId?: string;
    tripId?: string;
    tripHeadsign?: string;
    route?: otpRegistry.Otp1StopTime['route'];
  } = {},
): otpRegistry.Otp1StopTime {
  const now = Math.floor(Date.now() / 1000);
  const midnight = now - (now % 86400);
  const secsSinceMidnight = now - midnight + minutesFromNow * 60;

  return {
    pattern: {
      id: opts.patternId ?? '1:LI:test',
      desc: opts.patternDesc ?? `Port Jefferson Branch to ${headsign}`,
    },
    route: opts.route,
    times: [
      {
        scheduledDeparture: secsSinceMidnight,
        realtimeDeparture: secsSinceMidnight,
        departureDelay: 0,
        realtime: opts.realtime ?? false,
        serviceDay: midnight,
        tripId: opts.tripId ?? `LI:${minutesFromNow}::test`,
        tripHeadsign: opts.tripHeadsign,
        stopHeadsign: headsign,
      },
    ],
  };
}

/** MTA City Hall-shaped stoptime, mirroring the live OTP1 response. */
function makeMtaStoptime(headsign: string, minutesFromNow: number, line: 'N' | 'R' | 'W') {
  return makeStoptime(headsign, minutesFromNow, {
    patternId: `MTASBWY:${line}:1:02`,
    tripId: 'MTASBWY:96287',
    tripHeadsign: '86 St',
    route: {
      id: `MTASBWY:${line}`,
      shortName: line,
      longName: 'Broadway Local',
      mode: 'SUBWAY',
      color: 'F6BC26',
    },
  });
}

/** MTA trip-stoptimes fixture (Astoria → Manhattan → Brooklyn). */
function makeMtaTripTimes(): otpRegistry.Otp1TripStopTime[] {
  const base = 74190; // seconds since midnight
  const names = ['Astoria-Ditmars Blvd', 'Astoria Blvd', 'City Hall', 'Cortlandt St', 'Rector St'];
  return names.map((stopName, i) => ({
    stopId: `MTASBWY:STOP${i}`,
    stopName,
    stopLat: 40.775 - i * 0.015,
    stopLon: -73.912 - i * 0.02,
    stopIndex: i,
    scheduledArrival: base + i * 120,
    scheduledDeparture: base + i * 120,
    realtimeArrival: base + i * 120,
    realtimeDeparture: base + i * 120,
    realtime: i >= 2,
  }));
}

const TRIP_SERVICE_DAY = 1788494400;

// ── Tests ───────────────────────────────────────────────────────────

describe('fetchDepartures', () => {
  it('returns headway estimates when no OTP stop ID is found', async () => {
    findOtpStopIdsSpy.mockResolvedValue([]);

    const result = await fetchDepartures(
      'Merillon Avenue',
      40.7,
      -73.6,
      ['Port Jefferson'],
      ['0039A6'],
      ['RAIL'],
    );

    // Should fall back to headway estimation (3 departures per route, 20 min headway)
    expect(result.departures).toHaveLength(3);
    expect(result.departures[0].isRealtime).toBe(false);
    expect(result.departures[0].minutesAway).toBe(20);
  });

  it('returns OTP1 real departures when stop ID is found', async () => {
    findOtpStopIdsSpy.mockResolvedValue(['LI:Merillon Avenue']);
    fetchOtpRoutesAtStopSpy.mockResolvedValue([
      { ref: 'LI', name: 'Port Jefferson Branch', color: '0039A6', mode: 'RAIL' },
    ]);
    fetchOtp1StoptimesSpy.mockResolvedValue([
      makeStoptime('Penn Station', 10, { realtime: true }),
      makeStoptime('Huntington', 15),
      makeStoptime('Port Jefferson', 25),
    ]);

    const result = await fetchDepartures(
      'Merillon Avenue',
      40.7,
      -73.6,
      ['Port Jefferson'],
      ['0039A6'],
      ['RAIL'],
    );

    expect(result.departures.length).toBeGreaterThanOrEqual(3);
    // Departures should include both directions (towards Penn Station AND towards Port Jeff)
    const headsigns = result.departures.map((d) => d.headsign);
    expect(headsigns).toContain('Penn Station');
    expect(headsigns).toContain('Huntington');
    expect(headsigns).toContain('Port Jefferson');
  });

  it('includes real-time predictions from OTP1', async () => {
    findOtpStopIdsSpy.mockResolvedValue(['LI:Test']);
    fetchOtpRoutesAtStopSpy.mockResolvedValue([]);
    fetchOtp1StoptimesSpy.mockResolvedValue([
      makeStoptime('Penn Station', 5, { realtime: true }),
      makeStoptime('Hicksville', 12, { realtime: false }),
    ]);

    const result = await fetchDepartures('Test', 40.7, -73.6, ['LI'], [undefined], ['RAIL']);

    const live = result.departures.find((d) => d.headsign === 'Penn Station');
    const sched = result.departures.find((d) => d.headsign === 'Hicksville');
    expect(live?.isRealtime).toBe(true);
    expect(live?.realtimeTime).toBeDefined();
    expect(sched?.isRealtime).toBe(false);
    expect(sched?.realtimeTime).toBeUndefined();
  });

  it('falls back to headway when OTP1 stoptimes returns empty', async () => {
    findOtpStopIdsSpy.mockResolvedValue(['LI:Empty']);
    fetchOtpRoutesAtStopSpy.mockResolvedValue([]);
    fetchOtp1StoptimesSpy.mockResolvedValue([]);

    const result = await fetchDepartures('Empty', 40.7, -73.6, ['Test'], [undefined], ['RAIL']);

    // Should fall back to headway estimation
    expect(result.departures).toHaveLength(3);
    expect(result.departures.every((d) => !d.isRealtime)).toBe(true);
  });

  it('falls back to headway when OTP1 fetch throws', async () => {
    findOtpStopIdsSpy.mockRejectedValue(new Error('network error'));

    const result = await fetchDepartures('Error', 40.7, -73.6, ['Test'], [undefined], ['SUBWAY']);

    // Should fall back to headway estimation (5 min headway for SUBWAY)
    expect(result.departures).toHaveLength(3);
    expect(result.departures[0].minutesAway).toBe(5);
  });

  it('uses the actual line (not the agency ID) for MTA departures', async () => {
    findOtpStopIdsSpy.mockResolvedValue(['MTASBWY:R24S']);
    fetchOtpRoutesAtStopSpy.mockResolvedValue([
      { ref: 'N', name: 'Broadway Local', color: 'F6BC26', mode: 'SUBWAY' },
      { ref: 'R', name: 'Broadway Local', color: 'F6BC26', mode: 'SUBWAY' },
      { ref: 'W', name: 'Broadway Local', color: 'F6BC26', mode: 'SUBWAY' },
    ]);
    fetchOtp1StoptimesSpy.mockResolvedValue([
      makeMtaStoptime('Downtown & Brooklyn', 3, 'W'),
      makeMtaStoptime('Downtown & Brooklyn', 15, 'R'),
      makeMtaStoptime('Downtown & Brooklyn', 31, 'N'),
    ]);

    const result = await fetchDepartures('City Hall', 40.7133, -74.007, [], [], []);

    expect(result.departures).toHaveLength(3);
    expect(result.departures.map((d) => d.routeName)).toEqual(['W', 'R', 'N']);
    expect(result.departures.every((d) => d.routeName !== 'MTASBWY')).toBe(true);
    expect(result.departures.every((d) => d.color === 'F6BC26')).toBe(true);
    expect(result.departures.every((d) => d.mode === 'SUBWAY')).toBe(true);
    expect(result.departures[0].routeLongName).toBe('Broadway Local');
    // Stop badges are one per line, not per headsign/destination
    expect(result.routes.map((r) => r.name)).toEqual(['W', 'R', 'N']);
  });

  it('falls back to the pattern-id route segment when no route object is present', async () => {
    findOtpStopIdsSpy.mockResolvedValue(['MTASBWY:R24S']);
    fetchOtpRoutesAtStopSpy.mockResolvedValue([
      { ref: 'W', name: 'Broadway Local', color: 'F6BC26', mode: 'SUBWAY' },
    ]);
    fetchOtp1StoptimesSpy.mockResolvedValue([
      makeStoptime('Downtown & Brooklyn', 3, {
        patternId: 'MTASBWY:W:1:02',
        tripId: 'MTASBWY:96287',
      }),
    ]);

    const result = await fetchDepartures('City Hall', 40.7133, -74.007, [], [], []);

    expect(result.departures).toHaveLength(1);
    expect(result.departures[0].routeName).toBe('W');
    expect(result.departures[0].color).toBe('F6BC26');
    expect(result.departures[0].mode).toBe('SUBWAY');
  });

  it('merges departures from both directional stop IDs', async () => {
    findOtpStopIdsSpy.mockResolvedValue(['MTASBWY:R24S', 'MTASBWY:R24N']);
    fetchOtpRoutesAtStopSpy.mockImplementation(async (stopId: string) => {
      const line = stopId.endsWith('S') ? 'W' : 'N';
      return [{ ref: line, name: 'Broadway Local', color: 'F6BC26', mode: 'SUBWAY' }];
    });
    fetchOtp1StoptimesSpy.mockImplementation(async (stopId: string) => {
      if (stopId.endsWith('S')) return [makeMtaStoptime('Downtown & Brooklyn', 3, 'W')];
      return [makeMtaStoptime('Uptown & Queens', 8, 'N')];
    });

    const result = await fetchDepartures('City Hall', 40.7133, -74.007, [], [], []);

    expect(fetchOtp1StoptimesSpy).toHaveBeenCalledTimes(2);
    const headsigns = result.departures.map((d) => d.headsign);
    expect(headsigns).toContain('Downtown & Brooklyn');
    expect(headsigns).toContain('Uptown & Queens');
    // Sorted soonest-first across both directions
    expect(result.departures.map((d) => d.minutesAway)).toEqual([3, 8]);
    expect(result.departures.map((d) => d.routeName)).toEqual(['W', 'N']);
  });

  it('shows a clock time only when more than 60 minutes away', () => {
    expect(shouldShowClockTime(3)).toBe(false);
    expect(shouldShowClockTime(60)).toBe(false);
    expect(shouldShowClockTime(61)).toBe(true);
    expect(shouldShowClockTime(128)).toBe(true);
  });

  it('shows LIRR (not LI) when LIRR routes carry no short name', async () => {
    findOtpStopIdsSpy.mockResolvedValue(['LI:42']);
    fetchOtpRoutesAtStopSpy.mockResolvedValue([
      { ref: undefined, name: 'Port Jefferson Branch', color: '006EC7', mode: 'RAIL' },
    ]);
    fetchOtp1StoptimesSpy.mockResolvedValue([
      makeStoptime('Huntington', 2, {
        patternId: 'LI:10:0:01',
        patternDesc: 'Port Jefferson Branch to Huntington (LI:80)',
        tripId: 'LI:123::test',
        tripHeadsign: 'Huntington',
        route: { id: 'LI:10', longName: 'Port Jefferson Branch', mode: 'RAIL', color: '006EC7' },
      }),
    ]);

    const result = await fetchDepartures(
      'Mineola',
      40.73,
      -73.64,
      ['Port Jefferson'],
      ['006EC7'],
      ['RAIL'],
    );

    expect(result.departures).toHaveLength(1);
    expect(result.departures[0].routeName).toBe('LIRR');
    expect(result.departures[0].color).toBe('006EC7');
    expect(result.departures[0].mode).toBe('RAIL');
    expect(result.departures[0].tripId).toBe('LI:123::test');
  });

  it('carries trip identity on OTP departures for the trip-detail view', async () => {
    findOtpStopIdsSpy.mockResolvedValue(['MTASBWY:R24S']);
    fetchOtpRoutesAtStopSpy.mockResolvedValue([
      { ref: 'W', name: 'Broadway Local', color: 'F6BC26', mode: 'SUBWAY' },
    ]);
    fetchOtp1StoptimesSpy.mockResolvedValue([makeMtaStoptime('Downtown & Brooklyn', 3, 'W')]);

    const result = await fetchDepartures('City Hall', 40.7133, -74.007, [], [], []);

    expect(result.departures).toHaveLength(1);
    expect(result.departures[0].tripId).toBe('MTASBWY:96287');
    expect(result.departures[0].tripHeadsign).toBe('86 St');
    expect(result.departures[0].serviceDay).toBeDefined();
  });

  it('builds an ordered trip stop list anchored at the boarded station', () => {
    // "Now" is exactly the City Hall arrival (index 2)
    const nowMs = (TRIP_SERVICE_DAY + 74190 + 2 * 120) * 1000;
    const list = buildTripStopList(
      makeMtaTripTimes(),
      TRIP_SERVICE_DAY,
      { name: 'City Hall', lat: 40.7133, lon: -74.007 },
      nowMs,
    );

    expect(list.stops.map((s) => s.name)).toEqual([
      'Astoria-Ditmars Blvd',
      'Astoria Blvd',
      'City Hall',
      'Cortlandt St',
      'Rector St',
    ]);
    expect(list.currentIndex).toBe(2);
    expect(list.stops[2].scheduledTime).toBe(new Date(nowMs).toISOString());
    expect(list.stops[2].isRealtime).toBe(true);
    expect(list.stops[2].minutesAway).toBe(0);
    expect(list.stops[3].minutesAway).toBe(2);
    expect(list.stops[0].isRealtime).toBe(false);
  });

  it('falls back to nearest coordinates when the station name is absent', () => {
    const list = buildTripStopList(
      makeMtaTripTimes(),
      TRIP_SERVICE_DAY,
      // Closest to the Rector St fixture stop (index 4)
      { name: 'Unknown', lat: 40.715, lon: -73.992 },
      Date.now(),
    );
    expect(list.currentIndex).toBe(4);
  });

  it('omits times when no service day is available', () => {
    const list = buildTripStopList(
      makeMtaTripTimes(),
      undefined,
      { name: 'City Hall', lat: 40.7133, lon: -74.007 },
      Date.now(),
    );
    expect(list.currentIndex).toBe(2);
    expect(list.stops.every((s) => s.scheduledTime === undefined)).toBe(true);
    expect(list.stops.every((s) => s.minutesAway === undefined)).toBe(true);
  });

  it('formats trip stop status labels', () => {
    expect(formatTripStopStatus({ isRealtime: false })).toBe('Scheduled');
    expect(formatTripStopStatus({ isRealtime: true })).toBe('Live');
    expect(formatTripStopStatus({ isRealtime: true, minutesAway: -2 })).toBe('Live');
    expect(formatTripStopStatus({ isRealtime: true, minutesAway: 0 })).toBe('Live · now');
    expect(formatTripStopStatus({ isRealtime: true, minutesAway: 14 })).toBe('Live · in 14 min');
  });

  it('skips past departures and limits to 3 hours ahead', async () => {
    findOtpStopIdsSpy.mockResolvedValue(['LI:Filter']);
    fetchOtpRoutesAtStopSpy.mockResolvedValue([]);

    const now = Math.floor(Date.now() / 1000);
    const midnight = now - (now % 86400);
    const secsSinceMidnight = now - midnight;

    fetchOtp1StoptimesSpy.mockResolvedValue([
      {
        pattern: { id: '1', desc: 'To Penn' },
        times: [
          {
            // Past departure (10 minutes ago)
            scheduledDeparture: secsSinceMidnight - 600,
            realtimeDeparture: secsSinceMidnight - 600,
            departureDelay: 0,
            realtime: false,
            serviceDay: midnight,
            tripId: 'past',
            stopHeadsign: 'Past',
          },
          {
            // Future departure (5 minutes from now)
            scheduledDeparture: secsSinceMidnight + 300,
            realtimeDeparture: secsSinceMidnight + 300,
            departureDelay: 0,
            realtime: false,
            serviceDay: midnight,
            tripId: 'future',
            stopHeadsign: 'Future',
          },
        ],
      },
    ]);

    const result = await fetchDepartures('Filter', 40.7, -73.6, ['LI'], [undefined], ['RAIL']);

    const headsigns = result.departures.map((d) => d.headsign);
    expect(headsigns).toContain('Future');
    expect(headsigns).not.toContain('Past');
  });
});
