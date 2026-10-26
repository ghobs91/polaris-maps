jest.mock('../../src/native/valhalla/NativePolarisValhalla', () => ({
  __esModule: true,
  default: { computeRoute: jest.fn() },
}));

jest.mock('../../src/services/routing/routingService', () => ({
  parseLaneGuidance: jest.fn((lanes: unknown[] | undefined) =>
    lanes && lanes.length > 0
      ? { laneCount: lanes.length, activeLanes: [0], laneDirections: ['right'] }
      : undefined,
  ),
}));

import NativePolarisValhalla from '../../src/native/valhalla/NativePolarisValhalla';
import { computeRoute } from '../../src/native/valhalla';
import type { NativeValhallaRoute } from '../../src/native/valhalla/NativePolarisValhalla';
import { mphToKmh } from '../../src/utils/units';

function payload(maneuver: Record<string, unknown>): NativeValhallaRoute {
  return {
    summary: { distance_meters: 100, duration_seconds: 10, has_toll: false, has_ferry: false },
    legs: [
      {
        maneuvers: [
          {
            type: 'turn_right',
            instruction: 'Turn right',
            distance_meters: 50,
            duration_seconds: 5,
            begin_shape_index: 0,
            end_shape_index: 1,
            verbal_pre_transition: 'Turn right',
            ...maneuver,
          },
        ],
        distance_meters: 100,
        duration_seconds: 10,
      },
    ],
    geometry: '',
    bounding_box: [0, 0, 1, 1],
  } as NativeValhallaRoute;
}

beforeEach(() => jest.clearAllMocks());

describe('native maneuver mapping', () => {
  it('maps speed limit, street names, and lane guidance when present', async () => {
    (NativePolarisValhalla!.computeRoute as jest.Mock).mockResolvedValue([
      payload({
        street_names: ['Main St'],
        verbal_post_transition: 'then turn left',
        speed_limit: 40,
        lanes: [{ mask: 4 }],
      }),
    ]);

    const routes = await computeRoute([{ lat: 0, lng: 0 }], 'auto');
    const maneuver = routes[0].legs[0].maneuvers[0];

    expect(maneuver.speedLimitMph).toBeCloseTo(24.855, 3); // 40 km/h, deliberately unrounded
    expect(maneuver.streetNames).toEqual(['Main St']);
    expect(maneuver.verbalPostTransition).toBe('then turn left');
    expect(maneuver.laneGuidance).toBeDefined();
    expect(maneuver.laneGuidance?.laneCount).toBe(1);
  });

  it('round-trips metric limits back to the posted km/h value', async () => {
    // The sign converts mph back to km/h for metric users. Rounding at ingest
    // used to turn a 30 km/h zone into 31 and a 70 zone into 69.
    for (const kph of [30, 70, 110, 120]) {
      (NativePolarisValhalla!.computeRoute as jest.Mock).mockResolvedValue([
        payload({ speed_limit: kph }),
      ]);
      const routes = await computeRoute([{ lat: 0, lng: 0 }], 'auto');
      const shown = Math.round(mphToKmh(routes[0].legs[0].maneuvers[0].speedLimitMph!));
      expect(shown).toBe(kph);
    }
  });

  it('omits the fields when the native payload lacks them', async () => {
    (NativePolarisValhalla!.computeRoute as jest.Mock).mockResolvedValue([payload({})]);

    const routes = await computeRoute([{ lat: 0, lng: 0 }], 'auto');
    const maneuver = routes[0].legs[0].maneuvers[0];

    expect(maneuver.speedLimitMph).toBeUndefined();
    expect(maneuver.laneGuidance).toBeUndefined();
    expect(maneuver.streetNames).toBeUndefined();
  });
});
