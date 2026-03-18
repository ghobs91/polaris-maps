import React, { useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import MapLibreGL from '@maplibre/maplibre-react-native';
import { Ionicons } from '@expo/vector-icons';
import { useOsmPoiStore } from '../../stores/osmPoiStore';
import { filterPoisForDisplay } from '../../utils/poiSpatialFilter';
import { getPoiCategory } from '../../utils/poiCategories';
import type { OsmPoi } from '../../services/poi/osmFetcher';

/**
 * Anchor positions the pill so the icon circle (left side of pill) sits at
 * the map coordinate.  x=0.1 ≈ icon centre / total pill width.
 */
const ANCHOR = { x: 0.1, y: 0.5 } as const;

interface PoiBadgeProps {
  poi: OsmPoi;
  onPress: (poi: OsmPoi) => void;
}

function PoiBadge({ poi, onPress }: PoiBadgeProps) {
  const { icon, color } = getPoiCategory(poi.type, poi.subtype);

  return (
    <TouchableOpacity onPress={() => onPress(poi)} activeOpacity={0.75} style={styles.hitArea}>
      <View style={[styles.pill, { backgroundColor: color }]}>
        {/* Icon circle — semi-transparent white background separates it from pill colour */}
        <View style={styles.iconWrap}>
          <Ionicons name={icon} size={12} color="#FFFFFF" />
        </View>
        <Text style={styles.label} numberOfLines={1}>
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

  const handlePress = useCallback((poi: OsmPoi) => {
    useOsmPoiStore.getState().setSelectedPoi(poi);
  }, []);

  /** Non-overlapping, category-diverse subset — recomputed when pois/bounds/zoom change */
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
          <PoiBadge poi={poi} onPress={handlePress} />
        </MapLibreGL.MarkerView>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  /** Generous hit area so small pills are easily tappable */
  hitArea: {
    padding: 4,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    paddingVertical: 4,
    paddingLeft: 4,
    paddingRight: 9,
    gap: 5,
    maxWidth: 170,
    // Crisp white border for contrast against any map background
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.55)',
    // Shadow lifts the pill off the map surface
    shadowColor: '#000000',
    shadowOpacity: 0.4,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 5,
  },
  iconWrap: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
    flexShrink: 1,
    textShadowColor: 'rgba(0,0,0,0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 1,
  },
});
