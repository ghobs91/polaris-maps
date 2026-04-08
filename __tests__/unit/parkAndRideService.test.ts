// Mock native modules before other imports
jest.mock('../../src/native/valhalla', () => ({
  initialize: jest.fn(),
  computeRoute: jest.fn(),
  reroute: jest.fn(),
}));
jest.mock('../../src/services/regions/connectivityService', () => ({
  isOnline: jest.fn().mockReturnValue(true),
}));

import { shouldOfferParkAndRide } from '../../src/services/routing/parkAndRideService';
import * as transitRouting from '../../src/services/transit/transitRoutingService';

jest.mock('../../src/services/transit/transitRoutingService');
jest.mock('../../src/services/routing/routingService');

const mockGetNearbyStops = transitRouting.getNearbyStops as jest.MockedFunction<
  typeof transitRouting.getNearbyStops
>;

describe('shouldOfferParkAndRide', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns offered=false when no rail stops nearby', async () => {
    mockGetNearbyStops.mockResolvedValue([]);
    const result = await shouldOfferParkAndRide(40.75, -73.99);
    expect(result.offered).toBe(false);
  });

  it('returns offered=false when nearest rail stop is within 20-min walk', async () => {
    // 500m = ~360 seconds walk at 1.39 m/s, well under 1200s threshold
    mockGetNearbyStops.mockResolvedValue([
      {
        stop: {
          gtfsId: 'stop1',
          name: 'Penn Station',
          lat: 40.751,
          lon: -73.993,
          routes: [
            {
              gtfsId: 'route1',
              shortName: 'LIRR',
              mode: 'RAIL' as const,
            },
          ],
        },
        distanceMeters: 500,
        departures: [],
      },
    ]);
    const result = await shouldOfferParkAndRide(40.75, -73.99);
    expect(result.offered).toBe(false);
  });

  it('returns offered=true when nearest rail stop is farther than 20-min walk', async () => {
    // 2500m = ~1800 seconds walk at 1.39 m/s, over 1200s threshold
    mockGetNearbyStops.mockResolvedValue([
      {
        stop: {
          gtfsId: 'stop1',
          name: 'Mineola Station',
          lat: 40.747,
          lon: -73.64,
          routes: [
            {
              gtfsId: 'route1',
              shortName: 'LIRR',
              mode: 'RAIL' as const,
            },
          ],
        },
        distanceMeters: 2500,
        departures: [],
      },
    ]);
    const result = await shouldOfferParkAndRide(40.75, -73.7);
    expect(result.offered).toBe(true);
    expect(result.stationName).toBe('Mineola Station');
    expect(result.stationLat).toBe(40.747);
    expect(result.stationLng).toBe(-73.64);
  });

  it('ignores bus-only stops', async () => {
    mockGetNearbyStops.mockResolvedValue([
      {
        stop: {
          gtfsId: 'bus1',
          name: 'Bus Stop',
          lat: 40.751,
          lon: -73.993,
          routes: [
            {
              gtfsId: 'route1',
              shortName: 'N6',
              mode: 'BUS' as const,
            },
          ],
        },
        distanceMeters: 3000,
        departures: [],
      },
    ]);
    const result = await shouldOfferParkAndRide(40.75, -73.99);
    expect(result.offered).toBe(false);
  });

  it('returns offered=false when API throws', async () => {
    mockGetNearbyStops.mockRejectedValue(new Error('Network error'));
    const result = await shouldOfferParkAndRide(40.75, -73.99);
    expect(result.offered).toBe(false);
  });
});
