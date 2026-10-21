jest.mock('../../src/services/imagery/mapillaryTrafficControls', () => {
  const actual = jest.requireActual('../../src/services/imagery/mapillaryTrafficControls');
  return {
    ...actual,
    getTrafficControlStateAt: jest.fn(),
    isTrafficControlDataAvailable: jest.fn(),
  };
});

import type { ManeuverType, ValhallaManeuver, ValhallaRoute } from '../../src/models/route';
import { encodePolyline } from '../../src/utils/polyline';
import {
  assessTurn,
  choosePreferredRouteIndex,
  hassleTurnCount,
  hasTrafficControlWithin,
  isAcceptableDetour,
  isTurnManeuver,
  preferTurnManagedRoute,
  routePreferenceScore,
  HASSLE_TURN_PENALTY_SECONDS,
  type TurnAssessment,
} from '../../src/services/routing/hassleTurns';
import type { TrafficControlState } from '../../src/services/imagery/mapillaryTrafficControls';

const mocked = jest.requireMock('../../src/services/imagery/mapillaryTrafficControls') as {
  getTrafficControlStateAt: jest.Mock;
  isTrafficControlDataAvailable: jest.Mock;
};

function maneuver(type: ManeuverType, beginShapeIndex: number): ValhallaManeuver {
  return {
    type,
    instruction: type,
    distanceMeters: 100,
    durationSeconds: 10,
    beginShapeIndex,
    endShapeIndex: beginShapeIndex,
    verbalPreTransition: '',
  };
}

function makeRoute(origin: [number, number], durationSeconds: number): ValhallaRoute {
  const coords: [number, number][] = [
    origin,
    [origin[0] + 0.002, origin[1] + 0.002],
    [origin[0] + 0.004, origin[1]],
  ];
  return {
    summary: { distanceMeters: 1_000, durationSeconds, hasToll: false, hasFerry: false },
    legs: [
      {
        maneuvers: [maneuver('start', 0), maneuver('turn_left', 1), maneuver('destination', 2)],
        distanceMeters: 1_000,
        durationSeconds,
      },
    ],
    geometry: encodePolyline(coords),
    boundingBox: [origin[0], origin[1], origin[0] + 0.004, origin[1] + 0.002],
  };
}

function state(hasCoverage: boolean, controlled: boolean): TrafficControlState {
  return {
    lat: 40,
    lng: -74,
    hasCoverage,
    controls: controlled
      ? [
          {
            id: 'signal',
            kind: 'traffic-light',
            lat: 40,
            lng: -74,
            objectValue: 'object--traffic-light--general-upright',
          },
        ]
      : [],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mocked.isTrafficControlDataAvailable.mockReturnValue(true);
});

describe('isTurnManeuver', () => {
  it('counts intersection turns but not merges, ramps or roundabouts', () => {
    expect(isTurnManeuver(maneuver('turn_left', 0))).toBe(true);
    expect(isTurnManeuver(maneuver('sharp_right', 0))).toBe(true);
    expect(isTurnManeuver(maneuver('slight_left', 0))).toBe(true);
    expect(isTurnManeuver(maneuver('u_turn', 0))).toBe(true);
    expect(isTurnManeuver(maneuver('merge_left', 0))).toBe(false);
    expect(isTurnManeuver(maneuver('enter_roundabout', 0))).toBe(false);
    expect(isTurnManeuver(maneuver('exit_highway', 0))).toBe(false);
    expect(isTurnManeuver(maneuver('name_change', 0))).toBe(false);
  });
});

describe('assessTurn', () => {
  it('flags a turn with coverage and no control as a hassle turn', () => {
    const assessment = assessTurn(maneuver('turn_left', 0), state(true, false));
    expect(assessment.hassle).toBe(true);
    expect(assessment.hasCoverage).toBe(true);
    expect(assessment.hasTrafficControl).toBe(false);
  });

  it('clears a turn managed by a signal', () => {
    expect(assessTurn(maneuver('turn_left', 0), state(true, true)).hassle).toBe(false);
  });

  it('never penalises a turn where Mapillary has no coverage', () => {
    const assessment = assessTurn(maneuver('turn_left', 0), state(false, false));
    expect(assessment.hasCoverage).toBe(false);
    expect(assessment.hassle).toBe(false);
  });

  it('treats a failed lookup as unknown, not uncontrolled', () => {
    expect(assessTurn(maneuver('turn_left', 0), null).hassle).toBe(false);
  });

  it('does not assess non-turn maneuvers', () => {
    expect(assessTurn(maneuver('continue', 0), state(true, false)).hassle).toBe(false);
  });
});

describe('hasTrafficControlWithin', () => {
  it('ignores a control outside the association radius', () => {
    const far: TrafficControlState = {
      lat: 40,
      lng: -74,
      hasCoverage: true,
      controls: [
        {
          id: 'far',
          kind: 'stop-sign',
          lat: 40,
          lng: -74 + 0.001, // ~85 m east
          objectValue: 'regulatory--stop--g1',
        },
      ],
    };
    expect(hasTrafficControlWithin(far)).toBe(false);
  });
});

describe('route scoring', () => {
  it('adds the per-turn penalty to the raw duration', () => {
    const route = makeRoute([-74, 40], 600);
    const assessments: TurnAssessment[] = [
      assessTurn(maneuver('turn_left', 0), state(true, false)),
      assessTurn(maneuver('turn_right', 0), state(true, true)),
    ];
    expect(hassleTurnCount(assessments)).toBe(1);
    expect(routePreferenceScore(route, assessments)).toBe(600 + HASSLE_TURN_PENALTY_SECONDS);
  });

  it('caps the detour accepted for a calmer route', () => {
    expect(isAcceptableDetour(650, 600)).toBe(true);
    expect(isAcceptableDetour(1_000, 600)).toBe(false);
    expect(isAcceptableDetour(2_000, 1_300)).toBe(false);
  });

  it('promotes a calmer candidate when the detour is small', () => {
    const fast = makeRoute([-74, 40], 600);
    const calm = makeRoute([-74, 41], 640);
    const fastAssessments = [assessTurn(maneuver('turn_left', 0), state(true, false))];
    const calmAssessments = [assessTurn(maneuver('turn_left', 0), state(true, true))];

    expect(choosePreferredRouteIndex([fast, calm], [fastAssessments, calmAssessments])).toBe(1);
  });

  it('keeps the fastest candidate when the calmer one is too slow', () => {
    const fast = makeRoute([-74, 40], 600);
    const calm = makeRoute([-74, 41], 1_000);
    const fastAssessments = [assessTurn(maneuver('turn_left', 0), state(true, false))];
    const calmAssessments = [assessTurn(maneuver('turn_left', 0), state(true, true))];

    expect(choosePreferredRouteIndex([fast, calm], [fastAssessments, calmAssessments])).toBe(0);
  });
});

describe('preferTurnManagedRoute', () => {
  it('does nothing without at least two candidates', async () => {
    const only = makeRoute([-74, 40], 600);
    await expect(preferTurnManagedRoute([only], 'auto')).resolves.toEqual([only]);
    expect(mocked.getTrafficControlStateAt).not.toHaveBeenCalled();
  });

  it('leaves non-car routes alone', async () => {
    const a = makeRoute([-74, 40], 600);
    const b = makeRoute([-74, 41], 640);
    await expect(preferTurnManagedRoute([a, b], 'bicycle')).resolves.toEqual([a, b]);
    expect(mocked.getTrafficControlStateAt).not.toHaveBeenCalled();
  });

  it('reorders candidates so the managed-turn route leads', async () => {
    mocked.getTrafficControlStateAt.mockImplementation(async (lat: number) =>
      state(true, lat > 40.5),
    );

    const fast = makeRoute([-74, 40], 600);
    const calm = makeRoute([-74, 41], 640);

    const ranked = await preferTurnManagedRoute([fast, calm], 'auto');
    expect(ranked).toHaveLength(2);
    expect(ranked[0]).toBe(calm);
    expect(ranked[1]).toBe(fast);
  });

  it('returns the original order when every lookup is unknown', async () => {
    mocked.getTrafficControlStateAt.mockResolvedValue(null);

    const fast = makeRoute([-74, 40], 600);
    const calm = makeRoute([-74, 41], 1_000);

    await expect(preferTurnManagedRoute([fast, calm], 'auto')).resolves.toEqual([fast, calm]);
  });
});
