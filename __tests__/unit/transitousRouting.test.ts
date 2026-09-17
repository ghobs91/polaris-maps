import {
  normalizeMotisGeometry,
  planTransitousTrip,
  MOTIS_POLYLINE_PRECISION,
  OTP_POLYLINE_PRECISION,
} from '../../src/services/transit/transitousRouting';
import { planMotisTrip, type MotisPlanResponse } from '../../src/services/transit/transitousClient';
import { decodePolyline, encodePolyline } from '../../src/utils/polyline';

jest.mock('../../src/services/transit/transitousClient', () => {
  const actual = jest.requireActual('../../src/services/transit/transitousClient');
  return { ...actual, planMotisTrip: jest.fn() };
});

const mockPlan = planMotisTrip as jest.MockedFunction<typeof planMotisTrip>;

const plan: MotisPlanResponse = {
  from: { name: 'A', lat: 52.52, lon: 13.4 },
  to: { name: 'B', lat: 52.53, lon: 13.41 },
  direct: [],
  itineraries: [
    {
      startTime: '2026-01-01T10:00:00.000Z',
      endTime: '2026-01-01T10:20:00.000Z',
      duration: 1200,
      walkDistance: 150,
      transfers: 0,
      waitingTime: 60,
      legs: [
        {
          mode: 'transit',
          from: { name: 'Stop A', lat: 52.52, lon: 13.4 },
          to: { name: 'Stop B', lat: 52.53, lon: 13.41 },
          startTime: '2026-01-01T10:00:00.000Z',
          endTime: '2026-01-01T10:20:00.000Z',
          duration: 1200,
          distance: 3000,
          geometry: 'encoded',
          realTime: true,
          transit: {
            headSign: 'B',
            route: { shortName: 'U2', longName: 'U-Bahn', color: 'E2001A', type: 'subway' },
            intermediateStops: [{ name: 'Mid', lat: 52.525, lon: 13.405 }],
          },
        },
      ],
    },
  ],
};

describe('normalizeMotisGeometry', () => {
  it('converts precision-6 MOTIS geometry into the precision-5 OTP field', () => {
    const coords: [number, number][] = [
      [13.4, 52.52],
      [13.405, 52.525],
      [13.41, 52.53],
    ];
    const motis = encodePolyline(coords, MOTIS_POLYLINE_PRECISION);

    const normalized = normalizeMotisGeometry(motis);
    const decoded = decodePolyline(normalized, OTP_POLYLINE_PRECISION);

    expect(decoded).toHaveLength(3);
    decoded.forEach(([lng, lat], i) => {
      expect(lng).toBeCloseTo(coords[i][0], 4);
      expect(lat).toBeCloseTo(coords[i][1], 4);
    });
  });

  it('returns an empty string for missing geometry', () => {
    expect(normalizeMotisGeometry(undefined)).toBe('');
    expect(normalizeMotisGeometry('')).toBe('');
  });
});

describe('planTransitousTrip', () => {
  it('maps MOTIS itineraries and legs onto OtpItinerary', async () => {
    mockPlan.mockResolvedValue(plan);

    const itineraries = await planTransitousTrip({
      originLat: 52.52,
      originLon: 13.4,
      destLat: 52.53,
      destLon: 13.41,
    });

    expect(mockPlan).toHaveBeenCalledWith(
      expect.objectContaining({ fromPlace: '52.52,13.4', toPlace: '52.53,13.41' }),
    );
    expect(itineraries).toHaveLength(1);
    expect(itineraries![0].legs[0]).toMatchObject({
      mode: 'TRANSIT',
      headsign: 'B',
      realTime: true,
      route: { shortName: 'U2', mode: 'SUBWAY' },
    });
  });

  it('returns null when there are no itineraries', async () => {
    mockPlan.mockResolvedValue({ ...plan, itineraries: [] });
    await expect(
      planTransitousTrip({ originLat: 1, originLon: 1, destLat: 2, destLon: 2 }),
    ).resolves.toBeNull();
  });
});
