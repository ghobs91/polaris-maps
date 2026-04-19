jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getString: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
  })),
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
}));
jest.mock('expo-crypto', () => ({
  getRandomBytes: jest.fn(),
}));

import { useMapStore } from '../../src/stores/mapStore';

describe('stopSearchMarkers in mapStore', () => {
  beforeEach(() => {
    useMapStore.setState({
      stopSearchMarkers: [],
      pendingStopSelection: null,
    });
  });

  it('sets and clears stop search markers', () => {
    const markers = [
      { lat: 40.7, lng: -73.9, name: 'Place A' },
      { lat: 40.8, lng: -74.0, name: 'Place B' },
    ];
    useMapStore.getState().setStopSearchMarkers(markers);
    expect(useMapStore.getState().stopSearchMarkers).toEqual(markers);
    expect(useMapStore.getState().stopSearchMarkers).toHaveLength(2);

    useMapStore.getState().setStopSearchMarkers([]);
    expect(useMapStore.getState().stopSearchMarkers).toEqual([]);
  });

  it('sets and clears pendingStopSelection', () => {
    const selection = { lat: 40.75, lng: -73.95, name: 'Picked Stop' };
    useMapStore.getState().setPendingStopSelection(selection);
    expect(useMapStore.getState().pendingStopSelection).toEqual(selection);

    useMapStore.getState().setPendingStopSelection(null);
    expect(useMapStore.getState().pendingStopSelection).toBeNull();
  });

  it('stopSearchMarkers defaults to empty array', () => {
    useMapStore.setState({ stopSearchMarkers: undefined as any });
    useMapStore.getState().setStopSearchMarkers([]);
    expect(useMapStore.getState().stopSearchMarkers).toEqual([]);
  });
});
