import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { colors, spacing, borderRadius } from '../../constants/theme';
import { useMapStore } from '../../stores/mapStore';

interface MapControlsProps {
  onLocatePress: () => void;
}

export function MapControls({ onLocatePress }: MapControlsProps) {
  const { viewport, setViewport } = useMapStore();

  const zoomIn = () => setViewport({ zoom: Math.min(viewport.zoom + 1, 20) });
  const zoomOut = () => setViewport({ zoom: Math.max(viewport.zoom - 1, 0) });
  const resetBearing = () => setViewport({ bearing: 0 });

  return (
    <View style={styles.container}>
      {viewport.bearing !== 0 && (
        <TouchableOpacity style={styles.button} onPress={resetBearing}>
          <Text style={styles.icon}>🧭</Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity style={styles.button} onPress={zoomIn}>
        <Text style={styles.icon}>＋</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.button} onPress={zoomOut}>
        <Text style={styles.icon}>－</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.button} onPress={onLocatePress}>
        <Text style={styles.icon}>◎</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    right: spacing.md,
    bottom: 100,
    gap: spacing.xs,
  },
  button: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.round,
    backgroundColor: colors.white,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  icon: {
    fontSize: 20,
    color: colors.text,
  },
});
