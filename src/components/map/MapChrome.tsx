import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { compassVisible, computeScaleBar } from '../../utils/mapChrome';
import { formatDistance } from '../../utils/units';

interface MapChromeProps {
  bearing: number;
  pitch: number;
  zoom: number;
  lat: number;
  /** Reset heading + pitch to north-up, 2D. */
  onReset: () => void;
  /** Toggle between 2D (flat) and 3D (tilted) pitch. */
  onTogglePitch?: () => void;
  /** Bottom offset (safe-area aware), supplied by the host. */
  bottomInset?: number;
}

/**
 * Map chrome: a compass that appears when the map is rotated or tilted and
 * resets the orientation on tap, plus a latitude/zoom-aware scale bar.
 * Positioned with `pointerEvents="box-none"` so it never intercepts gestures
 * outside its own controls.
 */
export function MapChrome({
  bearing,
  pitch,
  zoom,
  lat,
  onReset,
  onTogglePitch,
  bottomInset = 12,
}: MapChromeProps) {
  const showCompass = compassVisible(bearing, pitch);
  const bar = computeScaleBar(zoom, lat);
  const is3d = pitch > 5;

  return (
    <View style={[styles.container, { bottom: bottomInset }]} pointerEvents="box-none">
      {showCompass && (
        <Pressable
          style={styles.compass}
          onPress={onReset}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Reset map orientation to north-up"
        >
          <Ionicons
            name="compass"
            size={30}
            color="#0A84FF"
            style={{ transform: [{ rotate: `${-bearing}deg` }] }}
          />
        </Pressable>
      )}
      {onTogglePitch && (
        <Pressable
          style={styles.chromeBtn}
          onPress={onTogglePitch}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={is3d ? 'Switch to 2D view' : 'Switch to 3D view'}
        >
          <Ionicons name={is3d ? 'map-outline' : 'cube-outline'} size={18} color="#FFFFFF" />
        </Pressable>
      )}
      <View
        style={styles.scale}
        accessibilityRole="image"
        accessibilityLabel={`Map scale ${formatDistance(bar.metres)}`}
      >
        <Text style={styles.scaleText}>{formatDistance(bar.metres)}</Text>
        <View style={[styles.scaleLine, { width: bar.widthPx }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 12,
    alignItems: 'flex-start',
    gap: 8,
  },
  compass: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: 'rgba(28,28,30,0.72)',
  },
  chromeBtn: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 17,
    backgroundColor: 'rgba(28,28,30,0.72)',
  },
  scale: {
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  scaleLine: {
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderLeftWidth: 2,
    borderRightWidth: 2,
    borderColor: 'rgba(255,255,255,0.85)',
  },
  scaleText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 2,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 3,
  },
});
