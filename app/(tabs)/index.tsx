import React, { useCallback, useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import * as Location from 'expo-location';
import { MapView } from '@/components/map/MapView';
import { MapControls } from '@/components/map/MapControls';
import { useMapStore } from '@/stores/mapStore';
import { useNavigationStore } from '@/stores/navigationStore';
import { initTileService } from '@/services/map/tileService';
import { ErrorBoundary } from '@/components/common';

export default function MapScreen() {
  const setViewport = useMapStore((s) => s.setViewport);
  const setTileServerPort = useMapStore((s) => s.setTileServerPort);
  const routeGeometry = useNavigationStore((s) => s.activeRoute?.geometry);

  useEffect(() => {
    initTileService()
      .then((port) => setTileServerPort(port))
      .catch(console.error);
  }, [setTileServerPort]);

  const handleLocate = useCallback(async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return;
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    setViewport({ lat: loc.coords.latitude, lng: loc.coords.longitude, zoom: 15 });
  }, [setViewport]);

  const handleMapPress = useCallback((lat: number, lng: number) => {
    useMapStore.getState().setSelectedLocation({ lat, lng });
  }, []);

  return (
    <ErrorBoundary>
      <View style={styles.container}>
        <MapView routeGeometry={routeGeometry} onMapPress={handleMapPress} />
        <MapControls onLocatePress={handleLocate} />
      </View>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
