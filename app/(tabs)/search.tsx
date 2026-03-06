import React, { useCallback, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { SearchBar } from '@/components/search/SearchBar';
import { SearchResults } from '@/components/search/SearchResults';
import { searchAddress, type GeocodingResult } from '@/services/geocoding/geocodingService';
import { useMapStore } from '@/stores/mapStore';
import { colors } from '@/constants/theme';

export default function SearchScreen() {
  const [results, setResults] = useState<GeocodingResult[]>([]);
  const setViewport = useMapStore((s) => s.setViewport);
  const setSelectedLocation = useMapStore((s) => s.setSelectedLocation);
  const router = useRouter();

  const handleSearch = useCallback(async (query: string) => {
    if (query.length < 2) {
      setResults([]);
      return;
    }
    const found = await searchAddress(query, 10);
    setResults(found);
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
    <View style={styles.container}>
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
});
