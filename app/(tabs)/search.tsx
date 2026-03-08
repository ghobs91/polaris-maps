import React, { useCallback, useRef, useState } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SearchBar } from '@/components/search/SearchBar';
import { SearchResults } from '@/components/search/SearchResults';
import { searchAddress, type GeocodingResult } from '@/services/geocoding/geocodingService';
import { useMapStore } from '@/stores/mapStore';
import { colors, spacing, typography } from '@/constants/theme';

export default function SearchScreen() {
  const [results, setResults] = useState<GeocodingResult[]>([]);
  const setViewport = useMapStore((s) => s.setViewport);
  const setSelectedLocation = useMapStore((s) => s.setSelectedLocation);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const debounceTimer = useRef<ReturnType<typeof setTimeout>>();

  const handleSearch = useCallback(async (query: string) => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    if (query.length < 2) {
      setResults([]);
      return;
    }
    debounceTimer.current = setTimeout(async () => {
      const found = await searchAddress(query, 10);
      setResults(found);
    }, 350);
  }, []);

  const handleSelect = useCallback(
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

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Text style={styles.title}>Search</Text>
      <SearchBar onSearch={handleSearch} />
      <SearchResults results={results} onSelect={handleSelect} />
    </View>
  );
}

const styles = StyleSheet.create({
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
