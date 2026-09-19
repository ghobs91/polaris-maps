// The service exists to speak when the navigation screen is unmounted, so the
// tts functions are mocked and asserted directly.
jest.mock('../../src/services/tts/ttsService', () => ({
  announceNavigationStart: jest.fn(),
  announceManeuver: jest.fn(),
  announceArrival: jest.fn(),
  announceOffRoute: jest.fn(),
  announceRerouted: jest.fn(),
  stopNavigationSpeech: jest.fn(),
}));

import {
  initNavigationVoice,
  teardownNavigationVoice,
} from '../../src/services/tts/navigationVoice';
import {
  announceArrival,
  announceManeuver,
  announceNavigationStart,
  announceOffRoute,
  announceRerouted,
  stopNavigationSpeech,
} from '../../src/services/tts/ttsService';
import { useNavigationStore } from '../../src/stores/navigationStore';
import { useNavigationTrackingStore } from '../../src/stores/navigationTrackingStore';
import type { ValhallaRoute } from '../../src/models/route';

function makeRoute(): ValhallaRoute {
  return {
    summary: { distanceMeters: 5000, durationSeconds: 600, hasToll: false, hasFerry: false },
    legs: [
      {
        distanceMeters: 5000,
        durationSeconds: 600,
        maneuvers: [
          {
            type: 'turn_right',
            instruction: 'Turn right onto Oak Ave',
            distanceMeters: 800,
            durationSeconds: 90,
            beginShapeIndex: 0,
            endShapeIndex: 2,
            streetNames: ['Oak Ave'],
            verbalPreTransition: 'Turn right onto Oak Avenue',
          },
        ],
      },
    ],
    geometry: '_p~iF~ps|U_ulLnnqC_mqNvxq`@',
    boundingBox: [-73.99, 40.74, -73.97, 40.76],
  };
}

describe('navigationVoice', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    teardownNavigationVoice();
    useNavigationStore.getState().stopNavigation();
    useNavigationTrackingStore.getState().setDistanceToTurn(null);
  });

  afterEach(() => {
    teardownNavigationVoice();
  });

  it('speaks start, maneuver ladder, reroute and arrival without the nav screen', () => {
    initNavigationVoice();

    useNavigationStore
      .getState()
      .startNavigation(makeRoute(), [], { lat: 40.76, lng: -73.97, name: 'Dest' }, 'auto');
    expect(announceNavigationStart).toHaveBeenCalledWith('Dest');

    useNavigationTrackingStore.getState().setDistanceToTurn(500);
    expect(announceManeuver).toHaveBeenCalledWith(
      expect.stringContaining('Turn right onto Oak Ave'),
      500,
      'Turn right onto Oak Avenue',
    );

    useNavigationStore.getState().setRerouting(true);
    expect(announceOffRoute).toHaveBeenCalledTimes(1);
    useNavigationStore.getState().setRerouting(false);
    expect(announceRerouted).toHaveBeenCalledTimes(1);

    useNavigationStore.getState().setArrived(true);
    expect(announceArrival).toHaveBeenCalledWith('Dest');

    useNavigationStore.getState().stopNavigation();
    expect(stopNavigationSpeech).toHaveBeenCalled();
  });
});
