import React, { useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import MapLibreGL from '@maplibre/maplibre-react-native';
import { Ionicons } from '@expo/vector-icons';
import { useOsmPoiStore } from '../../stores/osmPoiStore';
import { filterPoisForDisplay } from '../../utils/poiSpatialFilter';
import { getPoiCategory } from '../../utils/poiCategories';
import { useTheme } from '../../contexts/ThemeContext';
import type { OsmPoi } from '../../services/poi/osmFetcher';

/** Badge anchored so the icon circle sits at the map coordinate */
const ANCHOR = { x: 0.08, y: 0.5 } as const;

interface PoiBadgeProps {
  poi: OsmPoi;
  isDark: boolean;
  onPress: (poi: OsmPoi) => void;
}

function PoiBadge({ poi, isDark, onPress }: PoiBadgeProps) {
  const { icon, color } = getPoiCategory(poi.type, poi.subtype);

  return (
    <TouchableOpacity onPress={() => onPress(poi)} activeOpacity={0.75} style={styles.badgeHitArea}>
      <View style={styles.badge}>
        {/* Coloured category icon circle */}
        <View style={[styles.iconCircle, { backgroundColor: color }]}>
          <Ionicons name={icon} size={13} color="#FFFFFF" />
        </View>
        {/* POI name — colour matches the icon on dark maps; dark text on light */}
        <Text style={[styles.badgeName, { color: isDark ? color : '#1A1A1A' }]} numberOfLines={1}>
          {poi.name}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

export function POILayer() {
  const pois = useOsmPoiStore((s) => s.pois);
  const zoom = useOsmPoiStore((s) => s.currentZoom);
  const bounds = useOsmPoiStore((s) => s.viewportBounds);
  const { isDark } = useTheme();

  const handlePress = useCallback((poi: OsmPoi) => {
    useOsmPoiStore.getState().setSelectedPoi(poi);
  }, []);

  /** Spatially filtered, category-diverse subset — memoised on POI list + bounds + zoom */
  const visiblePois = useMemo(() => {
    if (!bounds || pois.length === 0) return [];
    return filterPoisForDisplay(pois, bounds, zoom);
  }, [pois, bounds, zoom]);

  if (visiblePois.length === 0) return null;

  return (
    <>
      {visiblePois.map((poi) => (
        <MapLibreGL.MarkerView
          key={poi.id}
          coordinate={[poi.lng, poi.lat]}
          anchor={ANCHOR}
          allowOverlap={false}
        >
          <PoiBadge poi={poi} isDark={isDark} onPress={handlePress} />
        </MapLibreGL.MarkerView>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  /** Extra hit area so small badges are still easily tappable */
  badgeHitArea: {
    padding: 4,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  iconCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    // Subtle shadow so the circle lifts off the map
    shadowColor: '#000000',
    shadowOpacity: 0.35,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 4,
    // White border like Apple Maps
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.9)',
  },
  badgeName: {
    fontSize: 11,
    fontWeight: '700',
    maxWidth: 120,
    // Text shadow helps legibility on complex map backgrounds
    textShadowColor: 'rgba(0,0,0,0.25)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
});
