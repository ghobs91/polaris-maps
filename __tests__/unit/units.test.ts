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
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => '0'.repeat(32)) }));

import { formatDistance, formatSpeed } from '../../src/utils/units';
import { useSettingsStore } from '../../src/stores/settingsStore';

describe('formatDistance', () => {
  it('uses feet below 0.1 mi and miles above (imperial)', () => {
    expect(formatDistance(30, false)).toBe('100 ft');
    expect(formatDistance(0, false)).toBe('50 ft');
    expect(formatDistance(160, false)).toBe('500 ft');
    expect(formatDistance(160.9344, false)).toBe('0.1 mi');
    expect(formatDistance(3218.688, false)).toBe('2.0 mi');
  });

  it('uses metres below 1 km and kilometres above (metric)', () => {
    expect(formatDistance(999, true)).toBe('999 m');
    expect(formatDistance(1000, true)).toBe('1.0 km');
    expect(formatDistance(2500, true)).toBe('2.5 km');
  });

  it('defaults to the units preference when not supplied', () => {
    useSettingsStore.getState().setUseMetric(true);
    expect(formatDistance(2000)).toBe('2.0 km');

    useSettingsStore.getState().setUseMetric(false);
    expect(formatDistance(2000)).toBe('1.2 mi');
  });
});

describe('formatSpeed', () => {
  it('formats imperial and metric', () => {
    expect(formatSpeed(30, false)).toBe('30 mph');
    expect(formatSpeed(30, true)).toBe('48 km/h');
    expect(formatSpeed(65, true)).toBe('105 km/h');
  });

  it('defaults to the units preference when not supplied', () => {
    useSettingsStore.getState().setUseMetric(true);
    expect(formatSpeed(30)).toBe('48 km/h');
    useSettingsStore.getState().setUseMetric(false);
    expect(formatSpeed(30)).toBe('30 mph');
  });
});
