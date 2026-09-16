jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getString: jest.fn(),
    getNumber: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
  })),
}));

import { assertPoiContributionEnabled } from '../../src/services/poi/contributionGate';
import { useSettingsStore } from '../../src/stores/settingsStore';

beforeEach(() => {
  useSettingsStore.setState({
    permissions: {
      locationEnabled: true,
      trafficTelemetryEnabled: true,
      poiContributionsEnabled: true,
      imagerySharingEnabled: false,
    },
  });
});

describe('POI contribution gate', () => {
  it('allows submission when consent is enabled', () => {
    expect(() => assertPoiContributionEnabled()).not.toThrow();
  });

  it('blocks submission when consent is disabled', () => {
    useSettingsStore.setState({
      permissions: {
        locationEnabled: true,
        trafficTelemetryEnabled: true,
        poiContributionsEnabled: false,
        imagerySharingEnabled: false,
      },
    });
    expect(() => assertPoiContributionEnabled()).toThrow(/disabled/i);
  });
});
