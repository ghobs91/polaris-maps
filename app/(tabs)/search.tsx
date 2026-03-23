import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SearchBar } from '@/components/search/SearchBar';
import { SearchResults } from '@/components/search/SearchResults';
import { SearchHistory } from '@/components/search/SearchHistory';
import { searchAddress, type GeocodingResult } from '@/services/geocoding/geocodingService';
import {
  getSearchHistory,
  addSearchHistory,
  removeSearchHistory,
  clearSearchHistory,
} from '@/services/search/searchHistoryService';
import { useMapStore } from '@/stores/mapStore';
import { spacing, typography } from '@/constants/theme';
import { useTheme } from '@/contexts/ThemeContext';
import { resolveSearchCategories } from '@/services/poi/categoryResolver';
import { searchByCategory } from '@/services/poi/categorySearchService';
import type { OsmPoi } from '@/services/poi/osmFetcher';
import type { GeocodingEntry } from '@/models/geocoding';

/** Convert a POI result into the GeocodingResult shape so existing UI reuses as-is. */
function osmPoiToGeocodingResult(poi: OsmPoi): GeocodingResult {
  const entry: GeocodingEntry = {
    id: poi.id,
    text: poi.name,
    type: 'place',
    housenumber: null,
    street: null,
    city: poi.tags['addr:city'] ?? null,
    state: null,
    postcode: null,
    country: null,
    lat: poi.lat,
    lng: poi.lng,
  };
  return { entry, rank: 0 };
}

export default function SearchScreen() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodingResult[]>([]);
  const [history, setHistory] = useState<GeocodingResult[]>([]);
  const setViewport = useMapStore((s) => s.setViewport);
  const setSelectedLocation = useMapStore((s) => s.setSelectedLocation);
  const viewport = useMapStore((s) => s.viewport);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const debounceTimer = useRef<ReturnType<typeof setTimeout>>();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  useEffect(() => {
    setHistory(getSearchHistory());
  }, []);

  const handleSearch = useCallback(
    async (q: string) => {
      setQuery(q);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      if (q.length < 2) {
        setResults([]);
        return;
      }
      debounceTimer.current = setTimeout(async () => {
        // If the query resolves to a known POI category, run category search
        // around the current map viewport instead of geocoding.
        const cats = resolveSearchCategories(q);
        if (cats) {
          try {
            // Derive a viewport bounding box from the current map center + zoom.
            const delta = Math.min(2, (360 / Math.pow(2, viewport.zoom)) * 2);
            const { lat, lng } = viewport;
            const poiResult = await searchByCategory(
              q,
              lat - delta,
              lng - delta,
              lat + delta,
              lng + delta,
            );
            if (poiResult && poiResult.pois.length > 0) {
              setResults(poiResult.pois.map(osmPoiToGeocodingResult));
              return;
            }
          } catch {
            // Category search failed entirely — fall through to geocoding
          }
        }
        // Fall back to address/geocoding search
        const found = await searchAddress(q, 10);
        setResults(found);
      }, 350);
    },
    [viewport],
  );

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
    (result: GeocodingResult) => {
      addSearchHistory(result);
      setHistory(getSearchHistory());
      navigateToResult(result);
    },
    [navigateToResult],
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

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Text style={styles.title}>Search</Text>
      <SearchBar onSearch={handleSearch} />
      {showHistory ? (
        <SearchHistory
          history={history}
          onSelect={handleSelect}
          onRemove={handleRemoveHistory}
          onClearAll={handleClearHistory}
        />
      ) : (
        <SearchResults results={results} onSelect={handleSelect} />
      )}
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
  });
