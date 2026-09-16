jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getString: jest.fn(),
    getNumber: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
  })),
}));

import { useMapStore, loadPersistedMapPrefs } from '../../src/stores/mapStore';
import { storage } from '../../src/services/storage/mmkv';

describe('map preference persistence', () => {
  it('falls back to defaults when nothing is stored', () => {
    (storage.getString as jest.Mock).mockReturnValueOnce(undefined);
    expect(loadPersistedMapPrefs()).toEqual({ trafficLayerVisible: false, mapStyle: 'default' });
  });

  it('restores a valid persisted style and layer toggle', () => {
    (storage.getString as jest.Mock).mockReturnValueOnce(
      JSON.stringify({ mapStyle: 'satellite', trafficLayerVisible: true }),
    );
    expect(loadPersistedMapPrefs()).toEqual({ trafficLayerVisible: true, mapStyle: 'satellite' });
  });

  it('ignores an unknown persisted style', () => {
    (storage.getString as jest.Mock).mockReturnValueOnce(
      JSON.stringify({ mapStyle: 'hologram', trafficLayerVisible: false }),
    );
    expect(loadPersistedMapPrefs().mapStyle).toBe('default');
  });

  it('persists both preferences when the style changes', () => {
    useMapStore.setState({ mapStyle: 'default', trafficLayerVisible: true });

    useMapStore.getState().setMapStyle('satellite');

    expect(useMapStore.getState().mapStyle).toBe('satellite');
    expect(storage.set).toHaveBeenCalledWith(
      'mapLayerToggles',
      JSON.stringify({ mapStyle: 'satellite', trafficLayerVisible: true }),
    );
  });

  it('persists both preferences when the traffic layer changes', () => {
    useMapStore.setState({ mapStyle: 'satellite', trafficLayerVisible: false });

    useMapStore.getState().setTrafficLayerVisible(true);

    expect(useMapStore.getState().trafficLayerVisible).toBe(true);
    expect(storage.set).toHaveBeenCalledWith(
      'mapLayerToggles',
      JSON.stringify({ mapStyle: 'satellite', trafficLayerVisible: true }),
    );
  });
});
