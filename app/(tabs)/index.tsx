import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import * as Location from 'expo-location';
import { MapView } from '@/components/map/MapView';
import type { MapViewHandle } from '@/components/map/MapView';
import { FloatingSearchPanel } from '@/components/map/FloatingSearchPanel';
import { NodeDashboardDrawer } from '@/components/map/NodeDashboardDrawer';
import { POIInfoCard } from '@/components/map/POIInfoCard';
import { useMapStore } from '@/stores/mapStore';
import { useNavigationStore } from '@/stores/navigationStore';
import { ErrorBoundary } from '@/components/common';

export default function MapScreen() {
  const setViewport = useMapStore((s) => s.setViewport);
  const activeRouteGeometry = useNavigationStore((s) => s.activeRoute?.geometry);
  const previewRouteGeometry = useNavigationStore((s) => s.routePreview?.geometry);
  const routeGeometry = activeRouteGeometry ?? previewRouteGeometry;
  const [showNodeDrawer, setShowNodeDrawer] = useState(false);

  // Center on user location at startup
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setViewport({ lat: loc.coords.latitude, lng: loc.coords.longitude, zoom: 13 });
    })();
  }, [setViewport]);

  const locateTo = useMapStore((s) => s.locateTo);
  const mapViewRef = useRef<MapViewHandle>(null);

  const handleLocate = useCallback(async () => {
    // Panel covers ~52% of screen height; offset camera so the dot
    // sits in the centre of the visible map area above the panel.
    const { height } = Dimensions.get('window');
    const panelOffset = Math.round(height * 0.52);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      // Use last-known for instant response, then update with fresh GPS fix
      const last = await Location.getLastKnownPositionAsync();
      if (last) {
        mapViewRef.current?.flyTo(last.coords.latitude, last.coords.longitude, 15, panelOffset);
        locateTo(last.coords.latitude, last.coords.longitude, 15);
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      mapViewRef.current?.flyTo(loc.coords.latitude, loc.coords.longitude, 15, panelOffset);
      locateTo(loc.coords.latitude, loc.coords.longitude, 15);
    } catch {
      // Location unavailable — silently ignore
    }
  }, [locateTo]);

  const handleMapPress = useCallback((lat: number, lng: number) => {
    useMapStore.getState().setSelectedLocation({ lat, lng });
  }, []);

  return (
    <ErrorBoundary>
      <View style={styles.container}>
        <MapView ref={mapViewRef} routeGeometry={routeGeometry} onMapPress={handleMapPress} />
        <FloatingSearchPanel
          onProfilePress={() => setShowNodeDrawer(true)}
          onLocatePress={handleLocate}
        />
        <NodeDashboardDrawer visible={showNodeDrawer} onClose={() => setShowNodeDrawer(false)} />
        <POIInfoCard />
      </View>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
