jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getString: jest.fn(),
    getNumber: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
  })),
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => '00000000000000000000000000000000'),
}));

jest.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
}));

jest.mock('../../src/services/traffic/probeCollector', () => ({
  startProbeCollector: jest.fn(),
  stopProbeCollector: jest.fn(),
  isCollecting: jest.fn(),
}));

jest.mock('../../src/services/identity/consent', () => ({
  hasCompletedConsent: jest.fn(),
}));

import { AppState } from 'react-native';
import {
  isCollecting,
  startProbeCollector,
  stopProbeCollector,
} from '../../src/services/traffic/probeCollector';
import { hasCompletedConsent } from '../../src/services/identity/consent';
import { useSettingsStore } from '../../src/stores/settingsStore';
import { useTrafficStore } from '../../src/stores/trafficStore';
import {
  disposeProbeCollection,
  initProbeCollection,
  isProbeCollectionAllowed,
} from '../../src/services/traffic/probeCollectionCoordinator';

const startMock = startProbeCollector as jest.Mock;
const stopMock = stopProbeCollector as jest.Mock;
const isCollectingMock = isCollecting as jest.Mock;
const consentMock = hasCompletedConsent as jest.Mock;

function setTelemetry(enabled: boolean): void {
  useSettingsStore.getState().setPermissions({ trafficTelemetryEnabled: enabled });
}

function lastAppStateHandler(): (state: string) => void {
  const calls = (AppState.addEventListener as jest.Mock).mock.calls;
  return calls[calls.length - 1][1];
}

beforeEach(() => {
  jest.clearAllMocks();
  (AppState as unknown as { currentState: string }).currentState = 'active';
  consentMock.mockReturnValue(true);
  isCollectingMock.mockReturnValue(false);
  useSettingsStore.setState({
    permissions: {
      locationEnabled: true,
      trafficTelemetryEnabled: true,
      poiContributionsEnabled: true,
      imagerySharingEnabled: false,
    },
  });
  useTrafficStore.setState({ isCollectingProbes: false });
});

afterEach(() => {
  disposeProbeCollection();
});

describe('probe collection coordinator', () => {
  it('does not collect before consent is completed', () => {
    consentMock.mockReturnValue(false);

    initProbeCollection();

    expect(startMock).not.toHaveBeenCalled();
    expect(stopMock).toHaveBeenCalled();
    expect(useTrafficStore.getState().isCollectingProbes).toBe(false);
    expect(isProbeCollectionAllowed()).toBe(false);
  });

  it('collects when consent is complete, telemetry is enabled, and foregrounded', () => {
    isCollectingMock.mockReturnValue(true);

    initProbeCollection();

    expect(startMock).toHaveBeenCalledTimes(1);
    expect(useTrafficStore.getState().isCollectingProbes).toBe(true);
    expect(isProbeCollectionAllowed()).toBe(true);
  });

  it('stops when the telemetry permission is revoked at runtime', () => {
    isCollectingMock.mockReturnValue(true);
    initProbeCollection();

    isCollectingMock.mockReturnValue(false);
    setTelemetry(false);

    expect(stopMock).toHaveBeenCalled();
    expect(useTrafficStore.getState().isCollectingProbes).toBe(false);
  });

  it('stops in the background and resumes when foregrounded', () => {
    isCollectingMock.mockReturnValue(true);
    initProbeCollection();
    startMock.mockClear();

    const handler = lastAppStateHandler();
    handler('background');
    expect(stopMock).toHaveBeenCalledTimes(1);

    handler('active');
    expect(startMock).toHaveBeenCalledTimes(1);
  });

  it('is idempotent on repeated init', () => {
    initProbeCollection();
    initProbeCollection();

    expect(AppState.addEventListener).toHaveBeenCalledTimes(1);
  });

  it('disposes listeners and stops collection', () => {
    isCollectingMock.mockReturnValue(true);
    initProbeCollection();
    const subscription = (AppState.addEventListener as jest.Mock).mock.results[0].value;

    disposeProbeCollection();

    expect(subscription.remove).toHaveBeenCalled();
    expect(stopMock).toHaveBeenCalled();
    expect(useTrafficStore.getState().isCollectingProbes).toBe(false);
  });
});
