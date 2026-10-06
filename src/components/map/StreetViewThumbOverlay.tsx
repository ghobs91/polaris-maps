import React, { useCallback } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useOsmPoiStore } from '../../stores/osmPoiStore';
import { useStreetViewStore } from '../../stores/streetViewStore';

const THUMB_SIZE = 72;

/**
 * Floating street-level preview anchored just above the place sheet, on the
 * left (Google Maps style). Rendered by the map screen so it floats over the map
 * rather than inside the place sheet. Tapping it opens the street-view viewer.
 */
export function StreetViewThumbOverlay({ bottom, left }: { bottom: number; left: number }) {
  const router = useRouter();
  const poi = useOsmPoiStore((s) => s.selectedPoi);
  const setSelectedPoi = useOsmPoiStore((s) => s.setSelectedPoi);
  const thumbUrl = useStreetViewStore((s) => s.thumbUrl);

  const open = useCallback(() => {
    if (!poi) return;
    setSelectedPoi(null);
    router.push({
      pathname: '/imagery/street-view',
      params: { lat: String(poi.lat), lng: String(poi.lng), name: poi.name },
    });
  }, [poi, router, setSelectedPoi]);

  if (!poi || !thumbUrl) return null;

  return (
    <View pointerEvents="box-none" style={[styles.mount, { bottom, left }]}>
      <Pressable
        style={styles.thumb}
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel="Open street view"
        testID="street-view-thumb-overlay"
      >
        <Image source={{ uri: thumbUrl }} style={styles.image} resizeMode="cover" />
        <View style={styles.badge}>
          <Ionicons name="binoculars-outline" size={12} color="#fff" />
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  mount: { position: 'absolute', zIndex: 18, elevation: 18 },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: 12,
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.85)',
    backgroundColor: 'rgba(0,0,0,0.3)',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  image: { width: '100%', height: '100%' },
  badge: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
