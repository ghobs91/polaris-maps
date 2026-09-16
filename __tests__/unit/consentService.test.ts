jest.mock('react-native-mmkv', () => {
  const data = new Map<string, unknown>();
  return {
    MMKV: jest.fn().mockImplementation(() => ({
      getString: (key: string) => data.get(key),
      getNumber: (key: string) => data.get(key),
      set: (key: string, value: unknown) => data.set(key, value),
      delete: (key: string) => data.delete(key),
    })),
  };
});

import {
  applyConsentChoices,
  getConsentChoices,
  getDefaultConsentChoices,
  hasCompletedConsent,
  resetConsent,
} from '../../src/services/identity/consent';
import { useSettingsStore } from '../../src/stores/settingsStore';

beforeEach(() => {
  resetConsent();
  useSettingsStore.setState({
    permissions: {
      locationEnabled: false,
      trafficTelemetryEnabled: false,
      poiContributionsEnabled: false,
      imagerySharingEnabled: false,
    },
  });
});

describe('consent service', () => {
  it('reports no completed consent initially', () => {
    expect(hasCompletedConsent()).toBe(false);
  });

  it('defaults every choice off (privacy-preserving)', () => {
    expect(getDefaultConsentChoices()).toEqual({
      locationEnabled: false,
      trafficTelemetryEnabled: false,
      poiContributionsEnabled: false,
      imagerySharingEnabled: false,
    });
  });

  it('records completion and applies choices to the settings store', () => {
    applyConsentChoices({
      locationEnabled: true,
      trafficTelemetryEnabled: true,
      poiContributionsEnabled: false,
      imagerySharingEnabled: false,
    });

    expect(hasCompletedConsent()).toBe(true);
    expect(useSettingsStore.getState().permissions).toEqual({
      locationEnabled: true,
      trafficTelemetryEnabled: true,
      poiContributionsEnabled: false,
      imagerySharingEnabled: false,
    });
  });

  it('reads current choices back for re-consent pre-fill', () => {
    applyConsentChoices({
      locationEnabled: false,
      trafficTelemetryEnabled: true,
      poiContributionsEnabled: false,
      imagerySharingEnabled: true,
    });

    expect(getConsentChoices()).toEqual({
      locationEnabled: false,
      trafficTelemetryEnabled: true,
      poiContributionsEnabled: false,
      imagerySharingEnabled: true,
    });
  });

  it('resetConsent clears the version so re-consent is required', () => {
    applyConsentChoices(getDefaultConsentChoices());
    expect(hasCompletedConsent()).toBe(true);

    resetConsent();
    expect(hasCompletedConsent()).toBe(false);
  });
});
