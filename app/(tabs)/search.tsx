import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SearchBar } from '@/components/search/SearchBar';
import { SearchResults } from '@/components/search/SearchResults';
import { SearchHistory } from '@/components/search/SearchHistory';
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
import { unifiedSearch, type UnifiedSearchResult } from '@/services/search/unifiedSearch';
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
  } catch { return null; }
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
  } catch { return null; }
}

/** Convert a UnifiedSearchResult into a GeocodingResult for the existing UI. */
function unifiedToGeocodingResult(r: UnifiedSearchResult): GeocodingResult {
  const entry: GeocodingEntry = {
    id: r.poi?.id ?? Math.round(r.lat * 1e6 + r.lng * 1e3),
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
  const lastQueryRef = useRef<string>('');
  const lastBboxRef = useRef<{ south: number; north: number; west: number; east: number } | null>(null);
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  useEffect(() => {
    setHistory(getSearchHistory());
  }, []);

  const handleSearch = useCallback(
    async (q: string) => {
      setQuery(q);
      lastQueryRef.current = q;
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      if (q.length < 2) {
        setResults([]);
        return;
      }

      // Pre-flight: detect raw coordinates or Plus Codes
      const coordResult = (await tryDetectCoordinates(q)) ?? (await tryDetectPlusCode(q));
      if (coordResult) {
        setViewport({ lat: coordResult.lat, lng: coordResult.lng, zoom: 16 });
        setSelectedLocation({ lat: coordResult.lat, lng: coordResult.lng });
        return;
      }

      debounceTimer.current = setTimeout(async () => {
        try {
          // Pass the actual map viewport bounds so nearby results get boosted
          const bounds = useOsmPoiStore.getState().viewportBounds;
          const unified = await unifiedSearch(q, {
            lat: viewport.lat,
            lng: viewport.lng,
            zoom: viewport.zoom,
            viewportBounds: bounds
              ? {
                  south: bounds.minLat,
                  north: bounds.maxLat,
                  west: bounds.minLng,
                  east: bounds.maxLng,
                }
              : undefined,
          });

          // Record the bbox that was used for this search
          const delta = Math.max(0.05, Math.min(2, (360 / Math.pow(2, viewport.zoom)) * 2));
          lastBboxRef.current = {
            south: viewport.lat - delta,
            north: viewport.lat + delta,
            west: viewport.lng - delta,
            east: viewport.lng + delta,
          };

          setResults(unified.map(unifiedToGeocodingResult));
        } catch {
          setResults([]);
        }
      }, 300);
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

  // Viewport-shift triggered refetch (Fix G)
  useEffect(() => {
    if (lastQueryRef.current.length < 2 || !lastBboxRef.current || showHistory) return;

    const prev = lastBboxRef.current;
    const prevCenterLat = (prev.south + prev.north) / 2;
    const prevCenterLng = (prev.west + prev.east) / 2;
    const prevHeight = prev.north - prev.south;
    const prevWidth = prev.east - prev.west;

    const latShift = Math.abs(viewport.lat - prevCenterLat);
    const lngShift = Math.abs(viewport.lng - prevCenterLng);

    if (latShift > prevHeight * 0.3 || lngShift > prevWidth * 0.3) {
      handleSearch(lastQueryRef.current);
    }
  }, [viewport.lat, viewport.lng, viewport.zoom]);

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
