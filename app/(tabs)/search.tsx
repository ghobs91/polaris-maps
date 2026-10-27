import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SearchBar } from '@/components/search/SearchBar';
import { SearchResults } from '@/components/search/SearchResults';
import { SearchHistory } from '@/components/search/SearchHistory';
import { SearchFilterSheet } from '@/components/search/SearchFilterSheet';
import { useSearchViewStore } from '@/stores/searchViewStore';
import type { GeocodingResult } from '@/services/geocoding/geocodingService';
import {
  getSearchHistory,
  addSearchHistory,
  removeSearchHistory,
  clearSearchHistory,
} from '@/services/search/searchHistoryService';
import { useMapStore } from '@/stores/mapStore';
import { useOsmPoiStore } from '@/stores/osmPoiStore';
import { spacing, typography } from '@/constants/theme';
import { useTheme } from '@/contexts/ThemeContext';
import { usePlaceSearch } from '@/hooks/usePlaceSearch';
import { resolveSearchCamera, type SearchCamera } from '@/utils/searchCamera';
import type { UnifiedSearchResult } from '@/services/search/unifiedSearch';
import type { GeocodingEntry } from '@/models/geocoding';

// ---------------------------------------------------------------------------
// Coordinate & Plus Code pre-flight detection
// ---------------------------------------------------------------------------

async function tryDetectCoordinates(input: string): Promise<{ lat: number; lng: number } | null> {
  try {
    if (input.length < 5 || !/\d/.test(input)) return null;
    const { convert } = await import('geo-coordinates-parser');
    const c = convert(input);
    if (c?.decimalLatitude && c?.decimalLongitude)
      return { lat: c.decimalLatitude, lng: c.decimalLongitude };
    return null;
  } catch {
    return null;
  }
}

const PLUS_CODE_RE = /^[23456789CFGHJMPQRVWX]{2,8}\+[23456789CFGHJMPQRVWX]{2,}/i;

async function tryDetectPlusCode(input: string): Promise<{ lat: number; lng: number } | null> {
  if (!PLUS_CODE_RE.test(input.trim())) return null;
  try {
    const { decode } = await import('pluscodes');
    const result = decode(input.trim());
    if (result?.latitude && result?.longitude)
      return { lat: result.latitude, lng: result.longitude };
    return null;
  } catch {
    return null;
  }
}

async function detectCoordinateInput(input: string): Promise<{ lat: number; lng: number } | null> {
  return (await tryDetectCoordinates(input)) ?? (await tryDetectPlusCode(input));
}

/** Convert a UnifiedSearchResult into a GeocodingResult for the existing UI. */
function unifiedToGeocodingResult(r: UnifiedSearchResult): GeocodingResult {
  const entry: GeocodingEntry = {
    // Address rows get a synthetic negative id so they cannot collide with a
    // real OSM node id (search history dedupes by id).
    id: r.poi?.id ?? -(Math.abs(Math.round(r.lat * 1e6 + r.lng * 1e3)) + 1),
    text: r.name,
    type: r.type === 'poi' ? 'place' : r.type === 'address' ? 'address' : 'place',
    housenumber: null,
    street: null,
    city: r.city ?? null,
    state: null,
    postcode: null,
    country: null,
    lat: r.lat,
    lng: r.lng,
  };
  return { entry, rank: r.score };
}

/** Live camera centre — `mapStore.viewport` only tracks programmatic moves. */
function liveCamera(): SearchCamera {
  const { lat, lng, zoom } = useMapStore.getState().viewport;
  const { viewportBounds, currentZoom } = useOsmPoiStore.getState();
  return resolveSearchCamera({ lat, lng, zoom }, viewportBounds, currentZoom);
}

export default function SearchScreen() {
  const [history, setHistory] = useState<GeocodingResult[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const searchFilters = useSearchViewStore((s) => s.filters);
  const activeFilterCount =
    (searchFilters.openNow != null ? 1 : 0) +
    (searchFilters.minRating != null ? 1 : 0) +
    (searchFilters.maxPriceLevel != null ? 1 : 0) +
    (searchFilters.maxDistanceKm != null ? 1 : 0) +
    ((searchFilters.categories?.length ?? 0) > 0 ? 1 : 0);
  const setViewport = useMapStore((s) => s.setViewport);
  const setSelectedLocation = useMapStore((s) => s.setSelectedLocation);
  // Subscribed so the viewport-shift refetch below re-runs when the map moves.
  const liveViewportBounds = useOsmPoiStore((s) => s.viewportBounds);
  const liveZoom = useOsmPoiStore((s) => s.currentZoom);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const lastBboxRef = useRef<{ south: number; north: number; west: number; east: number } | null>(
    null,
  );
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  useEffect(() => {
    setHistory(getSearchHistory());
  }, []);

  const placeSearch = usePlaceSearch({
    limit: 30,
    getContext: useCallback(() => {
      // Anchor on the live camera, not `mapStore.viewport` — that store only
      // tracks programmatic moves, so it still points at wherever the map was
      // last told to go after the user pans.
      const live = liveCamera();
      const delta = Math.max(0.05, Math.min(2, (360 / Math.pow(2, live.zoom)) * 2));
      // Capture the bbox this search used, so the viewport-shift effect can tell
      // when the map has moved far enough to warrant a refetch.
      lastBboxRef.current = {
        south: live.lat - delta,
        north: live.lat + delta,
        west: live.lng - delta,
        east: live.lng + delta,
      };
      const bounds = useOsmPoiStore.getState().viewportBounds;
      return {
        lat: live.lat,
        lng: live.lng,
        zoom: live.zoom,
        viewportBounds: bounds
          ? {
              south: bounds.minLat,
              north: bounds.maxLat,
              west: bounds.minLng,
              east: bounds.maxLng,
            }
          : undefined,
      };
    }, []),
    transformQuery: detectCoordinateInput,
    onTransformed: useCallback(
      (coords) => {
        setViewport({ lat: coords.lat, lng: coords.lng, zoom: 16 });
        setSelectedLocation({ lat: coords.lat, lng: coords.lng });
      },
      [setViewport, setSelectedLocation],
    ),
  });
  const { query, setQuery, visibleResults, loadMore, hasMore, isSearching, refetch } = placeSearch;

  const navigateToResult = useCallback(
    (result: GeocodingResult) => {
      setViewport({ lat: result.entry.lat, lng: result.entry.lng, zoom: 16 });
      setSelectedLocation({
        lat: result.entry.lat,
        lng: result.entry.lng,
        name: result.entry.text,
      });
      router.navigate('/(tabs)');
    },
    [setViewport, setSelectedLocation, router],
  );

  const handleSelect = useCallback(
    (unified: UnifiedSearchResult) => {
      const result = unifiedToGeocodingResult(unified);
      addSearchHistory(result, query);
      setHistory(getSearchHistory());
      navigateToResult(result);
    },
    [navigateToResult, query],
  );

  const handleSelectHistory = useCallback(
    (result: GeocodingResult) => {
      addSearchHistory(result, query);
      setHistory(getSearchHistory());
      navigateToResult(result);
    },
    [navigateToResult, query],
  );

  const handleRemoveHistory = useCallback((entryId: number) => {
    removeSearchHistory(entryId);
    setHistory(getSearchHistory());
  }, []);

  const handleClearHistory = useCallback(() => {
    clearSearchHistory();
    setHistory([]);
  }, []);

  const showHistory = query.length < 2 && history.length > 0;

  // Viewport-shift triggered refetch (Fix G): re-runs the query when the map
  // has been panned more than ~30% of the searched box since the last run.
  useEffect(() => {
    if (query.length < 2 || !lastBboxRef.current || showHistory) return;

    const prev = lastBboxRef.current;
    const prevCenterLat = (prev.south + prev.north) / 2;
    const prevCenterLng = (prev.west + prev.east) / 2;
    const prevHeight = prev.north - prev.south;
    const prevWidth = prev.east - prev.west;
    const live = liveCamera();

    const latShift = Math.abs(live.lat - prevCenterLat);
    const lngShift = Math.abs(live.lng - prevCenterLng);

    if (latShift > prevHeight * 0.3 || lngShift > prevWidth * 0.3) {
      refetch();
    }
  }, [liveViewportBounds, liveZoom, query, showHistory, refetch]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Text style={styles.title}>Search</Text>
      <SearchBar onSearch={setQuery} />
      {!showHistory && (
        <View style={styles.filterRow}>
          <TouchableOpacity
            style={styles.filterBtn}
            onPress={() => setShowFilters(true)}
            accessibilityRole="button"
            accessibilityLabel={`Filters and sort${activeFilterCount > 0 ? `, ${activeFilterCount} active` : ''}`}
          >
            <Ionicons name="options-outline" size={16} color={colors.textSecondary} />
            <Text style={[styles.filterText, { color: colors.textSecondary }]}>
              Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
            </Text>
          </TouchableOpacity>
        </View>
      )}
      {showHistory ? (
        <SearchHistory
          history={history}
          onSelect={handleSelectHistory}
          onRemove={handleRemoveHistory}
          onClearAll={handleClearHistory}
        />
      ) : query.trim().length >= 2 && !isSearching && visibleResults.length === 0 ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            No places match “{query.trim()}” nearby
          </Text>
          <Text style={[styles.emptyHint, { color: colors.textSecondary }]}>
            Add a city to search elsewhere, e.g. “{query.trim()} boston”.
          </Text>
        </View>
      ) : (
        <SearchResults
          results={visibleResults}
          onSelect={handleSelect}
          onEndReached={loadMore}
          hasMore={hasMore}
        />
      )}
      <SearchFilterSheet visible={showFilters} onClose={() => setShowFilters(false)} />
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    title: {
      ...typography.h2,
      color: colors.text,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
      paddingBottom: spacing.xs,
    },
    filterRow: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.xs,
    },
    filterBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingVertical: 4,
      paddingHorizontal: 10,
      borderRadius: 12,
    },
    filterText: {
      fontSize: 13,
      fontWeight: '600',
    },
    empty: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.xl,
      alignItems: 'center',
      gap: spacing.xs,
    },
    emptyTitle: {
      ...typography.body,
      fontWeight: '600',
      textAlign: 'center',
    },
    emptyHint: {
      ...typography.caption,
      textAlign: 'center',
    },
  });
