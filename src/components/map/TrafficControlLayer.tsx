import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapLibreGL from '@maplibre/maplibre-react-native';
import { useRouteTrafficControls } from '../../hooks/useRouteTrafficControls';

interface TrafficControlLayerProps {
  geometry?: string;
  /** Live position as [lng, lat], used to fetch only the road ahead. */
  position?: [number, number] | null;
  /** Navigation only — icons stay off route preview and browsing. */
  enabled?: boolean;
}

/**
 * Stop-sign and traffic-light icons along the route being driven.
 *
 * Rendered as `MarkerView`s rather than MapLibre symbol layers so the icons are
 * real React views: no sprite sheet or PNG assets to ship, and the shapes stay
 * crisp at every map zoom. Only controls on the driven line are shown — see
 * `useRouteTrafficControls` — and only while navigating.
 */
export function TrafficControlLayer({
  geometry,
  position,
  enabled = false,
}: TrafficControlLayerProps) {
  const controls = useRouteTrafficControls(geometry, position, enabled);

  if (!enabled || controls.length === 0) return null;

  return (
    <>
      {controls.map((control) => (
        <MapLibreGL.MarkerView
          key={control.id}
          coordinate={[control.lng, control.lat]}
          anchor={{ x: 0.5, y: 0.5 }}
          allowOverlap
        >
          <View pointerEvents="none" accessible={false} importantForAccessibility="no">
            {control.kind === 'stop-sign' ? <StopSignIcon /> : <TrafficLightIcon />}
          </View>
        </MapLibreGL.MarkerView>
      ))}
    </>
  );
}

function StopSignIcon() {
  return (
    <View style={styles.stopSign}>
      <Text style={styles.stopText} allowFontScaling={false} numberOfLines={1}>
        STOP
      </Text>
    </View>
  );
}

function TrafficLightIcon() {
  return (
    <View style={styles.lightBody}>
      <View style={[styles.lightBulb, styles.lightRed]} />
      <View style={[styles.lightBulb, styles.lightAmber]} />
      <View style={[styles.lightBulb, styles.lightGreen]} />
    </View>
  );
}

const styles = StyleSheet.create({
  stopSign: {
    width: 26,
    height: 26,
    borderRadius: 7,
    backgroundColor: '#C81E1E',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOpacity: 0.35,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  stopText: {
    color: '#FFFFFF',
    fontSize: 6.5,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  lightBody: {
    width: 14,
    height: 26,
    borderRadius: 4,
    backgroundColor: '#1C1C1E',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    shadowColor: '#000000',
    shadowOpacity: 0.35,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  lightBulb: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  lightRed: { backgroundColor: '#FF453A' },
  lightAmber: { backgroundColor: '#FFD60A' },
  lightGreen: { backgroundColor: '#32D74B' },
});
