jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getString: jest.fn(),
    getNumber: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
  })),
}));

import { useSettingsStore } from '../../src/stores/settingsStore';
import { storage } from '../../src/services/storage/mmkv';

describe('onboarding replay setting', () => {
  beforeEach(() => {
    useSettingsStore.setState({ showOnboardingOnLaunch: false });
    (storage.set as jest.Mock).mockClear();
  });

  it('is off by default', () => {
    expect(useSettingsStore.getState().showOnboardingOnLaunch).toBe(false);
  });

  it('toggles and persists across relaunch', () => {
    useSettingsStore.getState().setShowOnboardingOnLaunch(true);

    expect(useSettingsStore.getState().showOnboardingOnLaunch).toBe(true);
    const payload = JSON.parse((storage.set as jest.Mock).mock.calls.at(-1)[1]);
    expect(payload.showOnboardingOnLaunch).toBe(true);
  });
});
