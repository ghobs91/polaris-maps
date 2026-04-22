import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import * as Location from 'expo-location';
import { MapView } from '@/components/map/MapView';
import type { MapViewHandle } from '@/components/map/MapView';
import { FloatingSearchPanel } from '@/components/map/FloatingSearchPanel';
import { NodeDashboardDrawer } from '@/components/map/NodeDashboardDrawer';
import { POIInfoCard } from '@/components/map/POIInfoCard';
import { TransitStopCard } from '@/components/map/TransitStopCard';
import { useMapStore } from '@/stores/mapStore';
import { useNavigationStore } from '@/stores/navigationStore';
import { useOsmPoiStore } from '@/stores/osmPoiStore';
import { useTransitStops } from '@/hooks/useTransitStops';
import { useNavigationTrafficRefresh } from '@/hooks/useNavigationTrafficRefresh';
import { useTransitStore } from '@/stores/transitStore';
import { prewarmTransitCache } from '@/services/transit/transitLineFetcher';
import { preloadOtpStops } from '@/services/transit/otpEndpointRegistry';
import { resolveMapSelectionPoi } from '@/services/poi/mapSelectionPoi';
import { ErrorBoundary } from '@/components/common';

export default function MapScreen() {
  const setViewport = useMapStore((s) => s.setViewport);
  const activeRouteGeometry = useNavigationStore((s) => s.activeRoute?.geometry);
  const previewRouteGeometry = useNavigationStore((s) => s.routePreview?.geometry);
  const routeGeometry = activeRouteGeometry ?? previewRouteGeometry;
  const [showNodeDrawer, setShowNodeDrawer] = useState(false);

  // Fetch transit stops when transit layer is toggled on
  useTransitStops();

  // Fetch route-aligned traffic when a route preview or active route is shown
  useNavigationTrafficRefresh();

  // Center on user location at startup (skip if a programmatic locate is pending,
  // e.g. navigating here from My Places with resolved coordinates)
  useEffect(() => {
    (async () => {
      if (useMapStore.getState().locateTrigger > 0) return;
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setViewport({ lat: loc.coords.latitude, lng: loc.coords.longitude, zoom: 15 });
      // Pre-warm transit cache for metro area in background — non-blocking
      prewarmTransitCache(loc.coords.latitude, loc.coords.longitude).catch(() => {});
      // Pre-load OTP stops index so station search is instant
      preloadOtpStops(loc.coords.latitude, loc.coords.longitude);
    })();
  }, [setViewport]);

  const locateTo = useMapStore((s) => s.locateTo);
  const mapViewRef = useRef<MapViewHandle>(null);
  const longPressRequestRef = useRef(0);

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
    // Dismiss transit stop card on map tap
    useTransitStore.getState().setSelectedStop(null);
  }, []);

  const handleMapLongPress = useCallback(async (lat: number, lng: number) => {
    const requestId = longPressRequestRef.current + 1;
    longPressRequestRef.current = requestId;

    useMapStore.getState().setSelectedLocation(null);
    useTransitStore.getState().setSelectedStop(null);

    const selectedPoi = await resolveMapSelectionPoi(lat, lng);
    if (longPressRequestRef.current !== requestId) return;

    useOsmPoiStore.getState().setSelectedPoi(selectedPoi);
  }, []);

  return (
    <ErrorBoundary>
      <View style={styles.container}>
        <MapView
          ref={mapViewRef}
          routeGeometry={routeGeometry}
          onMapPress={handleMapPress}
          onMapLongPress={handleMapLongPress}
        />
        <FloatingSearchPanel
          onProfilePress={() => setShowNodeDrawer(true)}
          onLocatePress={handleLocate}
        />
        <NodeDashboardDrawer visible={showNodeDrawer} onClose={() => setShowNodeDrawer(false)} />
        <POIInfoCard />
        <TransitStopCard />
      </View>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F2F2F7' },
});
