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

describe('navigation settings', () => {
  beforeEach(() => {
    useSettingsStore.setState({ navigationAutoAdvanceLegs: true, navigationAutoEnd: true });
    (storage.set as jest.Mock).mockClear();
  });

  it('defaults auto-advance and auto-end on', () => {
    expect(useSettingsStore.getState().navigationAutoAdvanceLegs).toBe(true);
    expect(useSettingsStore.getState().navigationAutoEnd).toBe(true);
  });

  it('toggles auto-advance and persists the full settings payload', () => {
    useSettingsStore.getState().setNavigationAutoAdvanceLegs(false);

    expect(useSettingsStore.getState().navigationAutoAdvanceLegs).toBe(false);
    const payload = JSON.parse((storage.set as jest.Mock).mock.calls.at(-1)[1]);
    expect(payload.navigationAutoAdvanceLegs).toBe(false);
    expect(payload.navigationAutoEnd).toBe(true);
    // Existing settings must survive the write.
    expect(payload.permissions).toBeDefined();
    expect(payload.routePreferences).toBeDefined();
  });

  it('toggles auto-end independently', () => {
    useSettingsStore.getState().setNavigationAutoEnd(false);

    expect(useSettingsStore.getState().navigationAutoEnd).toBe(false);
    expect(useSettingsStore.getState().navigationAutoAdvanceLegs).toBe(true);
  });
});
