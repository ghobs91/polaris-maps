import React, { useCallback, useMemo, memo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import MapLibreGL from '@maplibre/maplibre-react-native';
import { Ionicons } from '@expo/vector-icons';
import { useOsmPoiStore } from '../../stores/osmPoiStore';
import { useMapStore } from '../../stores/mapStore';
import { useShallow } from 'zustand/react/shallow';
import { useTheme } from '../../contexts/ThemeContext';
import {
  filterPoiLabelsForDisplay,
  filterPoisForDisplay,
  STREET_LEVEL_POI_ZOOM,
} from '../../utils/poiSpatialFilter';
import {
  clusterPoisForDisplay,
  gridDegreesForPixels,
  type PoiCluster,
} from '../../utils/poiClustering';
import { getPoiCategory } from '../../utils/poiCategories';
import type { OsmPoi } from '../../services/poi/osmFetcher';

/**
 * Anchor positions the icon circle (bottom of the label+icon stack) at the
 * map coordinate.  x=0.5 (horizontal centre), y=1.0 (bottom edge).
 */
const ANCHOR = { x: 0.5, y: 1.0 } as const;
const CLUSTER_ANCHOR = { x: 0.5, y: 0.5 } as const;

interface PoiBadgeProps {
  poi: OsmPoi;
  showLabel: boolean;
  onPress: (poi: OsmPoi) => void;
}

const PoiBadge = memo(function PoiBadge({ poi, showLabel, onPress }: PoiBadgeProps) {
  const { isDark } = useTheme();
  const { icon, color } = getPoiCategory(poi.type, poi.subtype);

  return (
    <TouchableOpacity onPress={() => onPress(poi)} activeOpacity={0.75} style={styles.hitArea}>
      <View style={styles.marker}>
        {showLabel ? (
          <Text
            style={[styles.label, { color }, isDark ? styles.labelDark : styles.labelLight]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {poi.name}
          </Text>
        ) : null}
        {/* Small coloured icon circle at the map coordinate */}
        <View style={[styles.iconWrap, { backgroundColor: color }]}>
          <Ionicons name={icon} size={11} color="#FFFFFF" />
        </View>
      </View>
    </TouchableOpacity>
  );
});

const ClusterBadge = memo(function ClusterBadge({
  cluster,
  onPress,
}: {
  cluster: PoiCluster;
  onPress: (cluster: PoiCluster) => void;
}) {
  const { color } = getPoiCategory('', cluster.dominantCategory);
  const size = cluster.count >= 50 ? 38 : cluster.count >= 10 ? 32 : 28;

  return (
    <TouchableOpacity
      onPress={() => onPress(cluster)}
      activeOpacity={0.8}
      style={styles.hitArea}
      accessibilityRole="button"
      accessibilityLabel={`${cluster.count} places, ${cluster.dominantCategory}`}
    >
      <View
        style={[
          styles.cluster,
          { width: size, height: size, borderRadius: size / 2, backgroundColor: color },
        ]}
      >
        <Text style={styles.clusterText} numberOfLines={1}>
          {cluster.count}
        </Text>
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
  const setViewport = useMapStore((s) => s.setViewport);

  const handlePress = useCallback((poi: OsmPoi) => {
    useOsmPoiStore.getState().setSelectedPoi(poi);
  }, []);

  const handleClusterPress = useCallback(
    (cluster: PoiCluster) => {
      setViewport({ lat: cluster.lat, lng: cluster.lng, zoom: Math.min(zoom + 2, 18) });
    },
    [setViewport, zoom],
  );

  // When a category search is active, show those results instead of the
  // default viewport POIs — this mirrors Google/Apple Maps behaviour of
  // displaying search-result pills on the map.
  const activePois = categorySearchResults ?? pois;

  /** Non-overlapping, category-diverse subset — recomputed when pois/bounds/zoom change */
  const visiblePois = useMemo(() => {
    if (!bounds || activePois.length === 0) return [];
    return filterPoisForDisplay(activePois, bounds, zoom);
  }, [activePois, bounds, zoom]);

  const labeledPoiIds = useMemo(() => {
    if (!bounds || visiblePois.length === 0) return new Set<number>();
    return new Set(filterPoiLabelsForDisplay(visiblePois, bounds, zoom).map((poi) => poi.id));
  }, [bounds, visiblePois, zoom]);

  // Below street level, collapse nearby POIs into count badges instead of
  // dropping them (2.1/2.2). Offline-safe: purely computed from cached POIs.
  const clusters = useMemo(() => {
    if (visiblePois.length === 0 || zoom >= STREET_LEVEL_POI_ZOOM || !bounds) return null;
    const centerLat = (bounds.minLat + bounds.maxLat) / 2;
    return clusterPoisForDisplay(visiblePois, gridDegreesForPixels(zoom, centerLat));
  }, [visiblePois, zoom, bounds]);

  if (visiblePois.length === 0) return null;

  if (clusters) {
    const byId = new Map(visiblePois.map((poi) => [poi.id, poi]));
    return (
      <>
        {clusters.map((cluster) => {
          const single = cluster.count === 1 ? byId.get(cluster.poiIds[0]) : undefined;
          if (single) {
            return (
              <MapLibreGL.MarkerView
                key={`poi-${single.id}`}
                coordinate={[single.lng, single.lat]}
                anchor={ANCHOR}
              >
                <PoiBadge poi={single} showLabel={false} onPress={handlePress} />
              </MapLibreGL.MarkerView>
            );
          }
          return (
            <MapLibreGL.MarkerView
              key={`cluster-${cluster.lat.toFixed(4)},${cluster.lng.toFixed(4)}`}
              coordinate={[cluster.lng, cluster.lat]}
              anchor={CLUSTER_ANCHOR}
            >
              <ClusterBadge cluster={cluster} onPress={handleClusterPress} />
            </MapLibreGL.MarkerView>
          );
        })}
      </>
    );
  }

  return (
    <>
      {visiblePois.map((poi) => (
        <MapLibreGL.MarkerView
          key={poi.id}
          coordinate={[poi.lng, poi.lat]}
          anchor={ANCHOR}
          allowOverlap={zoom >= STREET_LEVEL_POI_ZOOM}
        >
          <PoiBadge poi={poi} showLabel={labeledPoiIds.has(poi.id)} onPress={handlePress} />
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
    maxWidth: 104,
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
    maxWidth: 104,
  },
  labelDark: {
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 3,
  },
  labelLight: {
    textShadowColor: 'rgba(255,255,255,1)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 6,
  },
  cluster: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.85)',
    shadowColor: '#000000',
    shadowOpacity: 0.5,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 4,
  },
  clusterText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
});
