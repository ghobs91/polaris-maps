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
import { MAX_FONT_SCALE_DENSE } from '../../constants/a11y';
import type { OsmPoi } from '../../services/poi/osmFetcher';

/** Centres an icon-only marker on its map coordinate. */
const ICON_ANCHOR = { x: 0.5, y: 0.5 } as const;
const CLUSTER_ANCHOR = { x: 0.5, y: 0.5 } as const;

const ICON_SIZE = 20;
const ICON_HALF = ICON_SIZE / 2;
/** Max width of the name pill, including its horizontal padding. */
const PILL_MAX_WIDTH = 126;
/**
 * Fixed footprint reserved for an icon + name marker. The pill tucks its left
 * edge under the icon, so the content is `icon + pill − half-icon` wide.
 * Pinning this width (rather than letting the truncated name size the marker)
 * keeps the icon on its map coordinate and gives every labeled marker one
 * stable anchor, however short the name is.
 */
const LABELED_MARKER_WIDTH = ICON_SIZE + PILL_MAX_WIDTH - ICON_HALF;
/** Puts the icon's centre on the coordinate inside the fixed footprint. */
const LABELED_ANCHOR = { x: ICON_HALF / LABELED_MARKER_WIDTH, y: 0.5 } as const;

interface PoiBadgeProps {
  poi: OsmPoi;
  showLabel: boolean;
  onPress: (poi: OsmPoi) => void;
}

const PoiBadge = memo(function PoiBadge({ poi, showLabel, onPress }: PoiBadgeProps) {
  const { isDark, colors } = useTheme();
  const { icon, color } = getPoiCategory(poi.type, poi.subtype);

  const accessibilityLabel = `${poi.name}, ${poi.subtype}`;

  const iconCircle = (
    <View style={[styles.iconWrap, { backgroundColor: color }]}>
      <Ionicons name={icon} size={11} color="#FFFFFF" />
    </View>
  );

  if (!showLabel) {
    return (
      <TouchableOpacity
        onPress={() => onPress(poi)}
        activeOpacity={0.75}
        style={styles.hitArea}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
      >
        {iconCircle}
      </TouchableOpacity>
    );
  }

  return (
    // Fixed-width, touch-transparent wrapper pins the icon on the coordinate;
    // the touchable itself hugs the visible icon + pill so the empty tail of
    // the wrapper stays pannable.
    <View style={styles.labeledRoot} pointerEvents="box-none">
      <TouchableOpacity
        onPress={() => onPress(poi)}
        activeOpacity={0.75}
        style={styles.labeledHitArea}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
      >
        <View style={styles.row}>
          {/* The icon anchors the pill: it sits on the coordinate, overlaps the
              pill's leading edge, and stacks above it via zIndex. */}
          {iconCircle}
          <View
            style={[
              styles.pill,
              isDark ? styles.pillDark : styles.pillLight,
              { paddingLeft: ICON_HALF + 3 },
            ]}
          >
            <Text
              style={[styles.label, { color: colors.text }]}
              numberOfLines={1}
              ellipsizeMode="tail"
              maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}
            >
              {poi.name}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    </View>
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
        <Text
          style={styles.clusterText}
          numberOfLines={1}
          maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}
        >
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

  // Below street level, collapse nearby POIs into count badges instead of
  // dropping them (2.1/2.2). Offline-safe: purely computed from cached POIs.
  const clusters = useMemo(() => {
    if (visiblePois.length === 0 || zoom >= STREET_LEVEL_POI_ZOOM || !bounds) return null;
    const centerLat = (bounds.minLat + bounds.maxLat) / 2;
    return clusterPoisForDisplay(visiblePois, gridDegreesForPixels(zoom, centerLat));
  }, [visiblePois, zoom, bounds]);

  const labeledPoiIds = useMemo(() => {
    if (!bounds || visiblePois.length === 0) return new Set<number>();
    // Labels are thinned across only the POIs rendered as standalone markers:
    // every visible POI at street level, or the single-POI clusters below it.
    // POIs folded into a count badge render no name, so they must not consume
    // a label slot and crowd out a real isolated marker.
    let individuallyRendered = visiblePois;
    if (clusters) {
      const singleIds = new Set(
        clusters.filter((cluster) => cluster.count === 1).map((cluster) => cluster.poiIds[0]),
      );
      individuallyRendered = visiblePois.filter((poi) => singleIds.has(poi.id));
    }
    return new Set(
      filterPoiLabelsForDisplay(individuallyRendered, bounds, zoom).map((poi) => poi.id),
    );
  }, [bounds, visiblePois, zoom, clusters]);

  if (visiblePois.length === 0) return null;

  if (clusters) {
    const byId = new Map(visiblePois.map((poi) => [poi.id, poi]));
    return (
      <>
        {clusters.map((cluster) => {
          const single = cluster.count === 1 ? byId.get(cluster.poiIds[0]) : undefined;
          if (single) {
            // Isolated POIs keep their name pill at every zoom; only grouped
            // POIs collapse into count badges. `labeledPoiIds` still thins the
            // labels so they never collide (see filterPoiLabelsForDisplay).
            const showLabel = labeledPoiIds.has(single.id);
            return (
              <MapLibreGL.MarkerView
                key={`poi-${single.id}`}
                coordinate={[single.lng, single.lat]}
                anchor={showLabel ? LABELED_ANCHOR : ICON_ANCHOR}
              >
                <PoiBadge poi={single} showLabel={showLabel} onPress={handlePress} />
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
      {visiblePois.map((poi) => {
        const showLabel = labeledPoiIds.has(poi.id);
        return (
          <MapLibreGL.MarkerView
            key={poi.id}
            coordinate={[poi.lng, poi.lat]}
            anchor={showLabel ? LABELED_ANCHOR : ICON_ANCHOR}
            allowOverlap={zoom >= STREET_LEVEL_POI_ZOOM}
          >
            <PoiBadge poi={poi} showLabel={showLabel} onPress={handlePress} />
          </MapLibreGL.MarkerView>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  /** Generous hit area so small icon-only markers are easily tappable. */
  hitArea: {
    padding: 4,
  },
  /** Reserves a stable footprint so the icon stays on its map coordinate. */
  labeledRoot: {
    width: LABELED_MARKER_WIDTH,
  },
  /** Hugs the visible icon + pill; vertical padding grows the touch target. */
  labeledHitArea: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconWrap: {
    width: ICON_SIZE,
    height: ICON_SIZE,
    borderRadius: ICON_HALF,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.85)',
    shadowColor: '#000000',
    shadowOpacity: 0.5,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    // Stacks the icon above the pill it anchors.
    zIndex: 2,
    elevation: 3,
  },
  pill: {
    // Tuck the leading edge under the icon's trailing half.
    marginLeft: -ICON_HALF,
    height: ICON_SIZE,
    maxWidth: PILL_MAX_WIDTH,
    justifyContent: 'center',
    paddingRight: 9,
    borderRadius: ICON_HALF,
    borderWidth: 1,
    zIndex: 1,
    elevation: 2,
    shadowColor: '#000000',
    shadowOpacity: 0.28,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  pillLight: {
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderColor: 'rgba(0,0,0,0.10)',
  },
  pillDark: {
    backgroundColor: 'rgba(28,28,45,0.92)',
    borderColor: 'rgba(255,255,255,0.16)',
  },
  label: {
    flexShrink: 1,
    fontSize: 11,
    fontWeight: '700',
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
