import React, { useMemo, useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
  StyleSheet,
  Modal,
  ActivityIndicator,
  Share,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { usePlaceListStore } from '../../src/stores/placeListStore';
import { useMapStore } from '../../src/stores/mapStore';
import { useOsmPoiStore } from '../../src/stores/osmPoiStore';
import { savedPlaceToOsmPoi } from '../../src/utils/placeToOsmPoi';
import { haversineMeters } from '../../src/utils/routeSnap';
import { suggestEmojiForList } from '../../src/utils/placeListEmoji';
import { searchPlaceAll } from '../../src/native/mapkit';
import type { NativeMapKitPoi } from '../../src/native/mapkit';
import { SavedPlaceRow } from '../../src/components/places';
import { PlaceActionBar } from '../../src/components/places';
import type { PlaceActionBarAction } from '../../src/components/places';
import { SaveToListSheet } from '../../src/components/places/SaveToListSheet';
import { exportFilename, toCSV, toGeoJSON } from '../../src/services/places/exportService';
import { setListShared } from '../../src/services/places/listSyncService';
import { loadPlaceEnrichmentForPlaces } from '../../src/services/places/placeEnrichmentService';
import type { PlaceEnrichment } from '../../src/services/places/placeEnrichmentService';
import { Button, ErrorBoundary, GlassView } from '../../src/components/common';
import { spacing, typography, borderRadius } from '../../src/constants/theme';
import { useTheme } from '../../src/contexts/ThemeContext';
import type { SavedPlace } from '../../src/models/placeList';

type SortMode = 'recent' | 'name';

export default function PlaceListDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const lists = usePlaceListStore((s) => s.lists);
  const updateList = usePlaceListStore((s) => s.updateList);
  const removePlace = usePlaceListStore((s) => s.removePlace);
  const addPlace = usePlaceListStore((s) => s.addPlace);
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
  const [enrichment, setEnrichment] = useState<Record<string, PlaceEnrichment>>({});
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [showAddPlace, setShowAddPlace] = useState(false);
  const [addQuery, setAddQuery] = useState('');
  const [addResults, setAddResults] = useState<NativeMapKitPoi[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const sortedPlaces = useMemo(() => {
    if (!list) return [];
    const places = [...list.places];
    if (sortMode === 'name') return places.sort((a, b) => a.name.localeCompare(b.name));
    return places.sort((a, b) => b.addedAt - a.addedAt);
  }, [list, sortMode]);

  // Resolve OSM enrichment (opening hours + website) for the whole list in one
  // cached query.
  const places = list?.places;
  useEffect(() => {
    if (!places || places.length === 0) {
      setEnrichment({});
      return undefined;
    }
    let cancelled = false;
    loadPlaceEnrichmentForPlaces(places)
      .then((loaded) => {
        if (!cancelled) setEnrichment(loaded);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [places]);

  // Best-effort user location for distance labels.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const last = await Location.getLastKnownPositionAsync();
        if (cancelled) return;
        if (last) {
          setUserCoords({ lat: last.coords.latitude, lng: last.coords.longitude });
          return;
        }
        const current = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (!cancelled) {
          setUserCoords({ lat: current.coords.latitude, lng: current.coords.longitude });
        }
      } catch {
        // Location unavailable — rows simply omit distance.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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

      // Suppress the RegionGate when navigating from a place — we want to
      // go straight to the map, not be blocked by a download prompt.
      useMapStore.getState().setSuppressRegionGate(true);

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
    setSortMode((prev) => (prev === 'recent' ? 'name' : 'recent'));
  }, []);

  const handleAddSearch = useCallback(async () => {
    const query = addQuery.trim();
    if (!query) return;
    setIsSearching(true);
    try {
      const results = await searchPlaceAll(query, regionHint);
      setAddResults(results);
    } catch {
      setAddResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [addQuery, regionHint]);

  const handleAddResult = useCallback(
    (result: NativeMapKitPoi) => {
      if (!list) return;
      const name = result.name?.trim() || addQuery.trim();
      addPlace(list.id, {
        name,
        lat: result.latitude,
        lng: result.longitude,
        address: result.formattedAddress ?? undefined,
        phone: result.phoneNumber ?? undefined,
        website: result.url ?? undefined,
        category: result.pointOfInterestCategory ?? undefined,
      });
      setShowAddPlace(false);
      setAddQuery('');
      setAddResults([]);
    },
    [list, addQuery, addPlace],
  );

  if (!list) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <Text style={styles.heading}>List not found</Text>
        <Button title="Go back" onPress={() => router.back()} variant="outline" />
      </View>
    );
  }

  const renderItem = useCallback(
    ({ item }: { item: SavedPlace }) => (
      <SavedPlaceRow
        place={item}
        openingHours={enrichment[item.id]?.openingHours ?? null}
        websiteUrl={enrichment[item.id]?.website}
        distanceMeters={
          userCoords && (item.lat !== 0 || item.lng !== 0)
            ? haversineMeters([userCoords.lng, userCoords.lat], [item.lng, item.lat])
            : null
        }
        onPress={() => handlePlacePress(item)}
        onLongPress={() => handleRemovePlace(item)}
        onSaveToList={() => setPlaceForSheet(item)}
      />
    ),
    [handlePlacePress, handleRemovePlace, enrichment, userCoords],
  );

  const handleExport = useCallback(() => {
    if (!list) return;
    const filename = exportFilename(list);
    Alert.alert('Export list', 'Choose a format to share', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'CSV',
        onPress: () => {
          void Share.share({ title: `${filename}.csv`, message: toCSV(list) });
        },
      },
      {
        text: 'GeoJSON',
        onPress: () => {
          void Share.share({ title: `${filename}.geojson`, message: toGeoJSON(list) });
        },
      },
    ]);
  }, [list]);

  const handleToggleShare = useCallback(() => {
    if (!list) return;
    // Currently private → start sharing; currently shared → make private.
    setListShared(list, list.isPrivate);
  }, [list]);

  const actions: PlaceActionBarAction[] = useMemo(
    () => [
      {
        key: 'add',
        icon: 'add-circle-outline',
        label: 'Add a place to this list',
        onPress: () => setShowAddPlace(true),
      },
      {
        key: 'sort',
        icon: 'swap-vertical',
        label: sortMode === 'recent' ? 'Sort by name' : 'Sort by recent',
        onPress: cycleSortMode,
      },
      {
        key: 'share',
        icon: 'share-outline',
        label: 'Export and share this list',
        onPress: handleExport,
      },
      {
        key: 'rename',
        icon: 'pencil',
        label: 'Rename this list',
        onPress: () => setIsEditing(true),
      },
    ],
    [sortMode, cycleSortMode, handleExport],
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
                  {list.emoji?.trim() || suggestEmojiForList(list.name)} {list.name}
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={handleToggleShare}
              accessibilityRole="switch"
              accessibilityState={{ checked: !list.isPrivate }}
              accessibilityLabel={list.isPrivate ? 'Make list shared' : 'Make list private'}
            >
              <Text style={styles.meta}>
                {list.isPrivate ? 'Private · tap to share' : 'Shared · tap to make private'} ·{' '}
                {list.places.length} {list.places.length === 1 ? 'place' : 'places'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <FlashList
          data={sortedPlaces}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>
                No places saved yet. Tap + to add a place, or save places from the map.
              </Text>
            </View>
          }
        />

        <PlaceActionBar actions={actions} />

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
              website={placeForSheet.website}
              phone={placeForSheet.phone}
              onDone={() => setPlaceForSheet(null)}
            />
          )}
        </Modal>

        {/* Add a place — search via MKLocalSearch and save straight into the list */}
        <Modal
          visible={showAddPlace}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setShowAddPlace(false)}
        >
          <View style={[styles.container, { paddingTop: insets.top }]}>
            <View style={styles.disambigHeader}>
              <Text style={styles.heading}>Add a place</Text>
              <Text style={styles.meta}>Search and tap a result to add it to "{list.name}".</Text>
            </View>
            <View style={styles.addSearchRow}>
              <GlassView material="regular" style={styles.addSearchWrap}>
                <Ionicons name="search" size={16} color={colors.textSecondary} />
                <TextInput
                  style={styles.addSearchInput}
                  placeholder="Search places…"
                  placeholderTextColor={colors.textSecondary}
                  value={addQuery}
                  onChangeText={setAddQuery}
                  autoFocus
                  autoCorrect={false}
                  returnKeyType="search"
                  onSubmitEditing={handleAddSearch}
                />
              </GlassView>
              <Button title="Search" onPress={handleAddSearch} size="sm" />
            </View>
            {isSearching ? (
              <ActivityIndicator style={styles.addSpinner} color={colors.primary} />
            ) : (
              <FlashList
                data={addResults}
                keyExtractor={(_, i) => String(i)}
                contentContainerStyle={styles.listContent}
                ListEmptyComponent={
                  <Text style={styles.addEmpty}>
                    {addQuery.trim() ? 'No matches — try a different search.' : ''}
                  </Text>
                }
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.disambigRow}
                    onPress={() => handleAddResult(item)}
                  >
                    <Text style={styles.disambigName} numberOfLines={1}>
                      {item.name ?? addQuery.trim()}
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
            )}
            <TouchableOpacity style={styles.disambigCancel} onPress={() => setShowAddPlace(false)}>
              <Text style={styles.disambigCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
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
            <FlashList
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
    listContent: { paddingBottom: 120 },
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
    addSearchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    addSearchWrap: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      borderRadius: borderRadius.round,
      borderCurve: 'continuous',
      overflow: 'hidden',
      paddingHorizontal: spacing.md,
    },
    addSearchInput: {
      ...typography.body,
      color: colors.text,
      flex: 1,
      paddingVertical: spacing.sm,
    },
    addSpinner: { marginTop: spacing.xl },
    addEmpty: {
      ...typography.bodySmall,
      color: colors.textSecondary,
      textAlign: 'center',
      padding: spacing.lg,
    },
    loadingOverlay: {
      ...StyleSheet.absoluteFill,
      backgroundColor: 'rgba(0,0,0,0.3)',
      justifyContent: 'center',
      alignItems: 'center',
    },
  });
