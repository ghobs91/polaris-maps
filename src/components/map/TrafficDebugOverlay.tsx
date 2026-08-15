import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useMapStore } from '../../stores/mapStore';
import { useTrafficStore } from '../../stores/trafficStore';
import { useNavigationStore } from '../../stores/navigationStore';
import { tomtomApiKey } from '../../constants/config';

/**
 * Temporary debug overlay for diagnosing traffic rendering issues on device.
 * Shows the API key status, store state, and last fetch timestamp.
 */
export function TrafficDebugOverlay() {
  const trafficLayerVisible = useMapStore((s) => s.trafficLayerVisible);
  const normalizedSegments = useTrafficStore((s) => s.normalizedSegments);
  const lastFetchAt = useTrafficStore((s) => s.lastExternalFetchAt);
  const routePreview = useNavigationStore((s) => s.routePreview);
  const activeRoute = useNavigationStore((s) => s.activeRoute);
  const isLoading = useTrafficStore((s) => s.isExternalFetchLoading);

  const routeGeometry = activeRoute?.geometry ?? routePreview?.geometry;
  const keyLen = typeof tomtomApiKey === 'string' ? tomtomApiKey.length : 0;
  const lastFetchText = lastFetchAt ? new Date(lastFetchAt * 1000).toLocaleTimeString() : 'never';

  return (
    <View style={styles.container} pointerEvents="none">
      <Text style={styles.line}>Key: {keyLen > 0 ? `${keyLen} chars` : 'MISSING'}</Text>
      <Text style={styles.line}>Visible: {trafficLayerVisible ? 'yes' : 'no'}</Text>
      <Text style={styles.line}>Route: {routeGeometry ? 'yes' : 'no'}</Text>
      <Text style={styles.line}>Segments: {normalizedSegments.length}</Text>
      <Text style={styles.line}>Loading: {isLoading ? 'yes' : 'no'}</Text>
      <Text style={styles.line}>Last fetch: {lastFetchText}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 100,
    left: 12,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 8,
    padding: 10,
    zIndex: 999,
  },
  line: {
    color: '#fff',
    fontSize: 11,
    fontFamily: 'Courier',
    marginVertical: 1,
  },
});
