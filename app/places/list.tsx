import React, { useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  Alert,
  StyleSheet,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlaceListStore } from '../../src/stores/placeListStore';
import { useMapStore } from '../../src/stores/mapStore';
import { useOsmPoiStore } from '../../src/stores/osmPoiStore';
import { savedPlaceToOsmPoi } from '../../src/utils/placeToOsmPoi';
import { searchPlaceAll } from '../../src/native/mapkit';
import type { NativeMapKitPoi } from '../../src/native/mapkit';
import { SavedPlaceRow } from '../../src/components/places';
import { SaveToListSheet } from '../../src/components/places/SaveToListSheet';
import { Button, ErrorBoundary } from '../../src/components/common';
import { spacing, typography, borderRadius } from '../../src/constants/theme';
import { useTheme } from '../../src/contexts/ThemeContext';
import type { SavedPlace } from '../../src/models/placeList';

type SortMode = 'recent' | 'name' | 'distance';

export default function PlaceListDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const lists = usePlaceListStore((s) => s.lists);
  const updateList = usePlaceListStore((s) => s.updateList);
  const removePlace = usePlaceListStore((s) => s.removePlace);
  const locateTo = useMapStore((s) => s.locateTo);
  const setSelectedLocation = useMapStore((s) => s.setSelectedLocation);
  const setPendingSearchQuery = useMapStore((s) => s.setPendingSearchQuery);
  const updatePlace = usePlaceListStore((s) => s.updatePlace);
  const setSelectedPoi = useOsmPoiStore((s) => s.setSelectedPoi);

  const list = lists.find((l) => l.id === id);
  const [sortMode, setSortMode] = useState<SortMode>('recent');
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(list?.name ?? '');
  const [placeForSheet, setPlaceForSheet] = useState<SavedPlace | null>(null);
  const [disambigResults, setDisambigResults] = useState<NativeMapKitPoi[]>([]);
  const [disambigPlace, setDisambigPlace] = useState<SavedPlace | null>(null);
  const [isResolving, setIsResolving] = useState(false);

  const sortedPlaces = useMemo(() => {
    if (!list) return [];
    const places = [...list.places];
    switch (sortMode) {
      case 'name':
        return places.sort((a, b) => a.name.localeCompare(b.name));
      case 'recent':
      default:
        return places.sort((a, b) => b.addedAt - a.addedAt);
    }
  }, [list, sortMode]);

  const handleRemovePlace = useCallback(
    (place: SavedPlace) => {
      if (!list) return;
      Alert.alert('Remove Place', `Remove "${place.name}" from this list?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => removePlace(list.id, place.id),
        },
      ]);
    },
    [list, removePlace],
  );

  // Extract a region hint from the list name (e.g. "Long Island" from "Long Island - Eats")
  const regionHint = useMemo(() => {
    if (!list) return null;
    const name = list.name;
    // Common patterns: "Region - Category", "Region: Category", "Region | Category",
    // or just multiple spaces like "Long Island   Breakfast"
    const separators = /\s*[-:|/]\s*|\s{2,}/;
    const parts = name
      .split(separators)
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length < 2) return null;
    // Heuristic: the first part is usually the location, unless it's a generic word
    const generic = new Set([
      'my',
      'favorites',
      'favourite',
      'saved',
      'starred',
      'want to go',
      'new',
    ]);
    const candidate = parts[0].toLowerCase();
    return generic.has(candidate) ? parts[1] || null : parts[0];
  }, [list]);

  const navigateToResult = useCallback(
    (place: SavedPlace, result: NativeMapKitPoi) => {
      const address = result.formattedAddress ?? undefined;
      if (list) {
        updatePlace(list.id, place.id, {
          lat: result.latitude,
          lng: result.longitude,
          address,
          phone: result.phoneNumber ?? undefined,
          website: result.url ?? undefined,
        });
      }
      locateTo(result.latitude, result.longitude, 15);
      setSelectedLocation({
        lat: result.latitude,
        lng: result.longitude,
        name: place.name,
      });
      // Show the full POI info card for the resolved place
      const resolvedPlace: SavedPlace = {
        ...place,
        lat: result.latitude,
        lng: result.longitude,
        address,
        phone: result.phoneNumber ?? place.phone,
        website: result.url ?? place.website,
      };
      setSelectedPoi(savedPlaceToOsmPoi(resolvedPlace));
      router.replace('/(tabs)');
    },
    [router, locateTo, setSelectedLocation, setSelectedPoi, updatePlace, list],
  );

  const handlePlacePress = useCallback(
    async (place: SavedPlace) => {
      const hasCoords = place.lat !== 0 || place.lng !== 0;

      if (hasCoords) {
        locateTo(place.lat, place.lng, 15);
        setSelectedLocation({ lat: place.lat, lng: place.lng, name: place.name });
        setSelectedPoi(savedPlaceToOsmPoi(place));
        router.replace('/(tabs)');
        return;
      }

      // No coordinates — search for candidates via MKLocalSearch
      setIsResolving(true);
      try {
        const results = await searchPlaceAll(place.name, regionHint);

        if (results.length === 1) {
          // Only one result — use it directly
          navigateToResult(place, results[0]);
          return;
        }

        if (results.length > 1) {
          // Multiple results — show disambiguation
          setDisambigPlace(place);
          setDisambigResults(results);
          return;
        }
      } catch (e) {
        console.warn('[PlaceList] searchPlaceAll failed:', e);
      } finally {
        setIsResolving(false);
      }

      // No results — fall back to search panel
      setPendingSearchQuery(place.name);
      router.replace('/(tabs)');
    },
    [
      router,
      locateTo,
      setSelectedLocation,
      setSelectedPoi,
      setPendingSearchQuery,
      navigateToResult,
      regionHint,
    ],
  );

  const handleDisambigSelect = useCallback(
    (result: NativeMapKitPoi) => {
      if (!disambigPlace) return;
      setDisambigResults([]);
      navigateToResult(disambigPlace, result);
      setDisambigPlace(null);
    },
    [disambigPlace, navigateToResult],
  );

  const handleSaveName = useCallback(() => {
    if (!list || !editName.trim()) return;
    updateList(list.id, { name: editName.trim() });
    setIsEditing(false);
  }, [list, editName, updateList]);

  const cycleSortMode = useCallback(() => {
    setSortMode((prev) => {
      if (prev === 'recent') return 'name';
      return 'recent';
    });
  }, []);

  if (!list) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <Text style={styles.heading}>List not found</Text>
        <Button title="Go back" onPress={() => router.back()} variant="outline" />
      </View>
    );
  }

  const renderItem = ({ item }: { item: SavedPlace }) => (
    <SavedPlaceRow
      place={item}
      onPress={() => handlePlacePress(item)}
      onLongPress={() => handleRemovePlace(item)}
      onSaveToList={() => setPlaceForSheet(item)}
    />
  );

  return (
    <ErrorBoundary>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Text style={styles.backText}>‹</Text>
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            {isEditing ? (
              <TextInput
                style={styles.editInput}
                value={editName}
                onChangeText={setEditName}
                onSubmitEditing={handleSaveName}
                onBlur={handleSaveName}
                autoFocus
                returnKeyType="done"
              />
            ) : (
              <TouchableOpacity onPress={() => setIsEditing(true)}>
                <Text style={styles.heading} numberOfLines={1}>
                  {list.name}
                </Text>
              </TouchableOpacity>
            )}
            <Text style={styles.meta}>
              {list.isPrivate ? 'Private' : 'Shared'} · {list.places.length}{' '}
              {list.places.length === 1 ? 'place' : 'places'}
            </Text>
          </View>
          <TouchableOpacity onPress={cycleSortMode} style={styles.sortButton}>
            <Text style={styles.sortText}>{sortMode === 'recent' ? '↕ Recent' : '↕ A-Z'}</Text>
          </TouchableOpacity>
        </View>

        <FlatList
          data={sortedPlaces}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>
                No places saved yet. Save places from the map or search.
              </Text>
            </View>
          }
        />

        <Modal
          visible={placeForSheet !== null}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setPlaceForSheet(null)}
        >
          {placeForSheet && (
            <SaveToListSheet
              poiUuid={placeForSheet.poiUuid}
              placeName={placeForSheet.name}
              lat={placeForSheet.lat}
              lng={placeForSheet.lng}
              address={placeForSheet.address}
              category={placeForSheet.category}
              onDone={() => setPlaceForSheet(null)}
            />
          )}
        </Modal>

        {/* Disambiguation modal — pick the correct location */}
        <Modal
          visible={disambigResults.length > 0}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => {
            setDisambigResults([]);
            setDisambigPlace(null);
          }}
        >
          <View style={[styles.container, { paddingTop: insets.top }]}>
            <View style={styles.disambigHeader}>
              <Text style={styles.heading}>Which location?</Text>
              <Text style={styles.meta}>
                Multiple results for "{disambigPlace?.name}". Tap the correct one.
              </Text>
            </View>
            <FlatList
              data={disambigResults}
              keyExtractor={(_, i) => String(i)}
              contentContainerStyle={styles.listContent}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.disambigRow}
                  onPress={() => handleDisambigSelect(item)}
                >
                  <Text style={styles.disambigName} numberOfLines={1}>
                    {item.name ?? disambigPlace?.name}
                  </Text>
                  <Text style={styles.disambigAddress} numberOfLines={2}>
                    {(item.formattedAddress ??
                      [item.thoroughfare, item.locality, item.administrativeArea]
                        .filter(Boolean)
                        .join(', ')) ||
                      'Address not available'}
                  </Text>
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity
              style={styles.disambigCancel}
              onPress={() => {
                setDisambigResults([]);
                setDisambigPlace(null);
              }}
            >
              <Text style={styles.disambigCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </Modal>

        {isResolving && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        )}
      </View>
    </ErrorBoundary>
  );
}

const createStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    backButton: { padding: spacing.xs, marginRight: spacing.xs },
    backText: { fontSize: 32, color: colors.primary, lineHeight: 34 },
    headerCenter: { flex: 1 },
    heading: { ...typography.h2, color: colors.text },
    meta: { ...typography.caption, color: colors.textSecondary, marginTop: 1 },
    editInput: {
      ...typography.h2,
      color: colors.text,
      borderBottomWidth: 2,
      borderBottomColor: colors.primary,
      paddingBottom: 2,
    },
    sortButton: {
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.sm,
      backgroundColor: colors.surface,
      borderRadius: borderRadius.sm,
    },
    sortText: { ...typography.caption, color: colors.textSecondary },
    listContent: { paddingBottom: spacing.xxl },
    emptyState: { padding: spacing.xl, alignItems: 'center' },
    emptyText: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
    disambigHeader: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    disambigRow: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    disambigName: { ...typography.body, color: colors.text, fontWeight: '600' },
    disambigAddress: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
    disambigCancel: {
      padding: spacing.md,
      alignItems: 'center',
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    disambigCancelText: { ...typography.body, color: colors.primary, fontWeight: '600' },
    loadingOverlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.3)',
      justifyContent: 'center',
      alignItems: 'center',
    },
  });
