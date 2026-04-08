import React, { useCallback, useMemo, memo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import MapLibreGL from '@maplibre/maplibre-react-native';
import { Ionicons } from '@expo/vector-icons';
import { useOsmPoiStore } from '../../stores/osmPoiStore';
import { useShallow } from 'zustand/react/shallow';
import { filterPoisForDisplay } from '../../utils/poiSpatialFilter';
import { getPoiCategory } from '../../utils/poiCategories';
import type { OsmPoi } from '../../services/poi/osmFetcher';

/**
 * Anchor positions the icon circle (bottom of the label+icon stack) at the
 * map coordinate.  x=0.5 (horizontal centre), y=1.0 (bottom edge).
 */
const ANCHOR = { x: 0.5, y: 1.0 } as const;

interface PoiBadgeProps {
  poi: OsmPoi;
  onPress: (poi: OsmPoi) => void;
}

const PoiBadge = memo(function PoiBadge({ poi, onPress }: PoiBadgeProps) {
  const { icon, color } = getPoiCategory(poi.type, poi.subtype);

  return (
    <TouchableOpacity onPress={() => onPress(poi)} activeOpacity={0.75} style={styles.hitArea}>
      <View style={styles.marker}>
        {/* Label above icon — category-coloured text with dark outline for readability */}
        <Text style={[styles.label, { color }]} numberOfLines={1}>
          {poi.name}
        </Text>
        {/* Small coloured icon circle at the map coordinate */}
        <View style={[styles.iconWrap, { backgroundColor: color }]}>
          <Ionicons name={icon} size={11} color="#FFFFFF" />
        </View>
      </View>
    </TouchableOpacity>
  );
});

export function POILayer() {
  const { pois, categorySearchResults, zoom, bounds } = useOsmPoiStore(
    useShallow((s) => ({
      pois: s.pois,
      categorySearchResults: s.categorySearchResults,
      zoom: s.currentZoom,
      bounds: s.viewportBounds,
    })),
  );

  const handlePress = useCallback((poi: OsmPoi) => {
    useOsmPoiStore.getState().setSelectedPoi(poi);
  }, []);

  // When a category search is active, show those results instead of the
  // default viewport POIs — this mirrors Google/Apple Maps behaviour of
  // displaying search-result pills on the map.
  const activePois = categorySearchResults ?? pois;

  /** Non-overlapping, category-diverse subset — recomputed when pois/bounds/zoom change */
  const visiblePois = useMemo(() => {
    if (!bounds || activePois.length === 0) return [];
    return filterPoisForDisplay(activePois, bounds, zoom);
  }, [activePois, bounds, zoom]);

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
          <PoiBadge poi={poi} onPress={handlePress} />
        </MapLibreGL.MarkerView>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  /** Generous hit area so small markers are easily tappable */
  hitArea: {
    padding: 4,
  },
  marker: {
    alignItems: 'center',
    maxWidth: 120,
  },
  iconWrap: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.7)',
    shadowColor: '#000000',
    shadowOpacity: 0.5,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 2,
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 3,
  },
});
