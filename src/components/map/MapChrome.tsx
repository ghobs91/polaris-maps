import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { compassVisible, computeScaleBar } from '../../utils/mapChrome';
import { formatDistance } from '../../utils/units';
import { MAX_FONT_SCALE_CHROME } from '../../constants/a11y';

interface MapChromeProps {
  bearing: number;
  pitch: number;
  zoom: number;
  lat: number;
  /** Reset heading + pitch to north-up, 2D. */
  onReset: () => void;
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
  bottomInset = 12,
}: MapChromeProps) {
  const showCompass = compassVisible(bearing, pitch);
  const bar = computeScaleBar(zoom, lat);

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
      <View
        style={styles.scale}
        accessibilityRole="image"
        accessibilityLabel={`Map scale ${formatDistance(bar.metres)}`}
      >
        <Text style={styles.scaleText} maxFontSizeMultiplier={MAX_FONT_SCALE_CHROME}>
          {formatDistance(bar.metres)}
        </Text>
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
