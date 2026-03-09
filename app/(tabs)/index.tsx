import React, { useCallback, useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import * as Location from 'expo-location';
import { MapView } from '@/components/map/MapView';
import { MapControls } from '@/components/map/MapControls';
import { LocationActionPanel } from '@/components/map/LocationActionPanel';
import { FloatingSearchPanel } from '@/components/map/FloatingSearchPanel';
import { useMapStore } from '@/stores/mapStore';
import { useNavigationStore } from '@/stores/navigationStore';
import { ErrorBoundary } from '@/components/common';

export default function MapScreen() {
  const setViewport = useMapStore((s) => s.setViewport);
  const activeRouteGeometry = useNavigationStore((s) => s.activeRoute?.geometry);
  const previewRouteGeometry = useNavigationStore((s) => s.routePreview?.geometry);
  const routeGeometry = activeRouteGeometry ?? previewRouteGeometry;

  // Center on user location at startup
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setViewport({ lat: loc.coords.latitude, lng: loc.coords.longitude, zoom: 13 });
    })();
  }, [setViewport]);

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
        <LocationActionPanel />
        <FloatingSearchPanel />
      </View>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
