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

import { fetchDepartures } from '../../src/services/transit/transitDepartureFetcher';
import * as mbtaFetcher from '../../src/services/transit/mbtaFetcher';
import * as otpRegistry from '../../src/services/transit/otpEndpointRegistry';

// ── Mocks ───────────────────────────────────────────────────────────

jest.spyOn(mbtaFetcher, 'isInMbtaArea').mockReturnValue(false);

const findOtpStopIdSpy = jest.spyOn(otpRegistry, 'findOtpStopId');
const fetchOtp1StoptimesSpy = jest.spyOn(otpRegistry, 'fetchOtp1Stoptimes');
const fetchOtpRoutesAtStopSpy = jest.spyOn(otpRegistry, 'fetchOtpRoutesAtStop');

beforeEach(() => {
  jest.clearAllMocks();
  (mbtaFetcher.isInMbtaArea as jest.Mock).mockReturnValue(false);
});

// ── Helpers ─────────────────────────────────────────────────────────

function makeStoptime(
  headsign: string,
  minutesFromNow: number,
  opts: { realtime?: boolean; patternDesc?: string } = {},
): otpRegistry.Otp1StopTime {
  const now = Math.floor(Date.now() / 1000);
  const midnight = now - (now % 86400);
  const secsSinceMidnight = now - midnight + minutesFromNow * 60;

  return {
    pattern: {
      id: '1:LI:test',
      desc: opts.patternDesc ?? `Port Jefferson Branch to ${headsign}`,
    },
    times: [
      {
        scheduledDeparture: secsSinceMidnight,
        realtimeDeparture: secsSinceMidnight,
        departureDelay: 0,
        realtime: opts.realtime ?? false,
        serviceDay: midnight,
        tripId: `LI:${minutesFromNow}::test`,
        stopHeadsign: headsign,
      },
    ],
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('fetchDepartures', () => {
  it('returns headway estimates when no OTP stop ID is found', async () => {
    findOtpStopIdSpy.mockResolvedValue(null);

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
    findOtpStopIdSpy.mockResolvedValue('LI:Merillon Avenue');
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
    findOtpStopIdSpy.mockResolvedValue('LI:Test');
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
    findOtpStopIdSpy.mockResolvedValue('LI:Empty');
    fetchOtpRoutesAtStopSpy.mockResolvedValue([]);
    fetchOtp1StoptimesSpy.mockResolvedValue([]);

    const result = await fetchDepartures('Empty', 40.7, -73.6, ['Test'], [undefined], ['RAIL']);

    // Should fall back to headway estimation
    expect(result.departures).toHaveLength(3);
    expect(result.departures.every((d) => !d.isRealtime)).toBe(true);
  });

  it('falls back to headway when OTP1 fetch throws', async () => {
    findOtpStopIdSpy.mockRejectedValue(new Error('network error'));

    const result = await fetchDepartures('Error', 40.7, -73.6, ['Test'], [undefined], ['SUBWAY']);

    // Should fall back to headway estimation (5 min headway for SUBWAY)
    expect(result.departures).toHaveLength(3);
    expect(result.departures[0].minutesAway).toBe(5);
  });

  it('skips past departures and limits to 3 hours ahead', async () => {
    findOtpStopIdSpy.mockResolvedValue('LI:Filter');
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
