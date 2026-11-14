import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  ScrollView,
  StyleSheet,
  Animated,
  Platform,
  Keyboard,
  ActivityIndicator,
  Pressable,
  InteractionManager,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GlassView } from '../common/GlassView';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import type { UnifiedSearchResult } from '../../services/search/unifiedSearch';
import { usePlaceSearch } from '../../hooks/usePlaceSearch';
import { ADD_STOP_SHORTCUTS } from '../../constants/searchCategories';
import { computeRoute } from '../../services/routing/routingService';
import { useNavigationStore } from '../../stores/navigationStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useMapStore } from '../../stores/mapStore';
import { decodePolyline } from '../../utils/polyline';
import { selectStopsAlongRoute } from '../../utils/routeCorridor';
import { formatDistance } from '../../utils/units';
import { spacing, nav } from '../../constants/theme';

/** Options listed before the user expands the submitted overview. */
const COLLAPSED_RESULT_LIMIT = 3;

function detourKey(r: { lat: number; lng: number }): string {
  return `${r.lat.toFixed(5)},${r.lng.toFixed(5)}`;
}

/** Human-readable detour label. `undefined` = still calculating, `null` = failed. */
function detourLabel(detour: number | null | undefined): string | null {
  if (detour === undefined) return 'Calculating detour…';
  if (detour === null) return null;
  if (detour <= 90) return 'On route';
  return `+${Math.round(detour / 60)} min detour`;
}

interface AddDestinationPanelProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (result: UnifiedSearchResult) => void;
  searchCenter: { lat: number; lng: number };
  /** Called when the user submits a search so the host can show the route overview (break camera follow). */
  onShowOnMap?: () => void;
}

export function AddDestinationPanel({
  visible,
  onClose,
  onSelect,
  searchCenter,
  onShowOnMap,
}: AddDestinationPanelProps) {
  const [isListening, setIsListening] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  /** True after the user hits search — results stay visible with detour times + map pins. */
  const [submitted, setSubmitted] = useState(false);
  /** True when the submitted overview shows every option rather than the top few. */
  const [showAll, setShowAll] = useState(false);
  /** Origin snapshotted at submit, used to cut the corridor to the road ahead. */
  const [corridorOrigin, setCorridorOrigin] = useState<{ lat: number; lng: number } | null>(null);
  const [detours, setDetours] = useState<Record<string, number | null>>({});
  const slideAnim = useRef(new Animated.Value(0)).current;
  const inputRef = useRef<TextInput>(null);
  const detourGenRef = useRef(0);
  /** Latest search center, read at search time so the session never closes
   *  over a stale GPS position. */
  const searchCenterRef = useRef(searchCenter);
  searchCenterRef.current = searchCenter;

  const {
    query,
    setQuery,
    results,
    isSearching: loading,
    submit: submitSearch,
    clear: clearSearch,
  } = usePlaceSearch({
    limit: 8,
    debounceMs: 350,
    getContext: useCallback(() => {
      const center = searchCenterRef.current;
      return { lat: center.lat, lng: center.lng, zoom: 14, userLocation: center };
    }, []),
  });
  /** Route origin snapshotted when the user submits the search. The live
   *  `searchCenter` prop moves with GPS, so the detour effect must NOT
   *  depend on it — otherwise every position tick restarts all detour
   *  requests and they read as "calculating" forever. */
  const submittedOriginRef = useRef<{ lat: number; lng: number } | null>(null);

  const activeRoute = useNavigationStore((s) => s.activeRoute);
  const waypoints = useNavigationStore((s) => s.waypoints);
  const currentLegIndex = useNavigationStore((s) => s.currentLegIndex);
  const destination = useNavigationStore((s) => s.destination);
  const costing = useNavigationStore((s) => s.costing);
  const pendingStopSelection = useMapStore((s) => s.pendingStopSelection);

  /** Decoded active route, used to keep suggestions beside the drive. */
  const routeCoords = useMemo<Array<[number, number]>>(
    () => (activeRoute?.geometry ? decodePolyline(activeRoute.geometry) : []),
    [activeRoute?.geometry],
  );

  // Only options near the road ahead are worth showing: a place across town is
  // not "along the route" however close it is to the car. Falls back to the
  // nearest few when the corridor has nothing.
  const alongRoute = useMemo(
    () => selectStopsAlongRoute(results, routeCoords, corridorOrigin),
    [results, routeCoords, corridorOrigin],
  );

  // Best options first: shortest added drive time, still-calculating last.
  const orderedResults = useMemo(() => {
    if (!submitted) return alongRoute;
    const rank = (result: UnifiedSearchResult) =>
      detours[detourKey(result)] ?? Number.POSITIVE_INFINITY;
    return [...alongRoute].sort((a, b) => {
      const left = rank(a);
      const right = rank(b);
      if (left === right) return 0;
      return left < right ? -1 : 1;
    });
  }, [submitted, alongRoute, detours]);

  const listedResults = showAll ? orderedResults : orderedResults.slice(0, COLLAPSED_RESULT_LIMIT);

  // Drop pins for the submitted options so the zoomed-out route shows them.
  useEffect(() => {
    if (!submitted || alongRoute.length === 0) return;
    useMapStore
      .getState()
      .setStopSearchMarkers(alongRoute.map((r) => ({ lat: r.lat, lng: r.lng, name: r.name })));
  }, [submitted, alongRoute]);

  // Animate panel in/out
  useEffect(() => {
    if (visible) {
      clearSearch();
      setSubmitted(false);
      setShowAll(false);
      setDetours({});
      Animated.timing(slideAnim, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, slideAnim, clearSearch]);

  // Track keyboard height and pad the panel above it. (A KeyboardAvoidingView
  // with behavior="padding" doesn't shift this absolutely-positioned bottom
  // sheet, which left the input hidden behind the keyboard.)
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) => {
      setKeyboardHeight(e.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Focus the input after layout settles — autoFocus fires while the slide-up
  // animation is still running, which races the keyboard and leaves the input
  // covered on first open.
  useEffect(() => {
    if (visible) {
      const handle = InteractionManager.runAfterInteractions(() => {
        inputRef.current?.focus();
      });
      return () => handle.cancel();
    }
  }, [visible]);

  // Handle speech recognition events
  useSpeechRecognitionEvent('result', (event) => {
    const transcript = event.results[0]?.transcript ?? '';
    if (transcript) {
      void submitSearch(transcript);
    }
    setIsListening(false);
  });

  useSpeechRecognitionEvent('error', () => {
    setIsListening(false);
  });

  useSpeechRecognitionEvent('end', () => {
    setIsListening(false);
  });

  const checkPermissions = useCallback(async () => {
    try {
      const { granted } = await ExpoSpeechRecognitionModule.getPermissionsAsync();
      if (!granted) {
        const { granted: requested } = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
        return requested;
      }
      return granted;
    } catch {
      return false;
    }
  }, []);

  const toggleVoiceSearch = useCallback(async () => {
    if (isListening) {
      ExpoSpeechRecognitionModule.stop();
      setIsListening(false);
      return;
    }

    const granted = await checkPermissions();
    if (!granted) return;

    setQuery('');
    setIsListening(true);

    try {
      ExpoSpeechRecognitionModule.start({
        lang: 'en-US',
        interimResults: false,
        maxAlternatives: 1,
        addsPunctuation: true,
        iosTaskHint: 'search',
      });
    } catch {
      setIsListening(false);
    }
  }, [isListening, checkPermissions]);

  const handleChangeText = useCallback(
    (text: string) => {
      setQuery(text);
      // New keystrokes invalidate the submitted overview — clear pins/detours
      // until the user hits search again.
      setSubmitted(false);
      setShowAll(false);
      setDetours({});
      useMapStore.getState().setStopSearchMarkers([]);
    },
    [setQuery],
  );

  // User hit search/submit: keep the list visible, drop pins for the options
  // along the route, and zoom out to the full route so they can pick a stop.
  const runSubmittedSearch = useCallback(
    async (searchQuery: string) => {
      const searchResults = await submitSearch(searchQuery);
      if (searchResults.length === 0) return;
      Keyboard.dismiss();
      // Freeze the origin for the corridor + detour math — see submittedOriginRef.
      const origin = { lat: searchCenter.lat, lng: searchCenter.lng };
      submittedOriginRef.current = origin;
      setCorridorOrigin(origin);
      setSubmitted(true);
      setShowAll(false);
      const coords: Array<[number, number]> = [];
      if (activeRoute?.geometry) {
        coords.push(...decodePolyline(activeRoute.geometry));
      }
      // Only the options beside the drive get pins, so the zoomed-out overview
      // matches the list instead of showing every result the query returned.
      const along = selectStopsAlongRoute(searchResults, coords, origin);
      useMapStore
        .getState()
        .setStopSearchMarkers(along.map((r) => ({ lat: r.lat, lng: r.lng, name: r.name })));
      for (const r of along) coords.push([r.lng, r.lat]);
      if (coords.length > 0) {
        let minLng = Infinity;
        let minLat = Infinity;
        let maxLng = -Infinity;
        let maxLat = -Infinity;
        for (const [lng, lat] of coords) {
          if (lng < minLng) minLng = lng;
          if (lat < minLat) minLat = lat;
          if (lng > maxLng) maxLng = lng;
          if (lat > maxLat) maxLat = lat;
        }
        // "search" mode: MapView pads the bottom for the sheet so pins clear it.
        useMapStore.getState().setFitBounds([minLng, minLat, maxLng, maxLat], 'search');
      }
      onShowOnMap?.();
    },
    [submitSearch, activeRoute, onShowOnMap, searchCenter],
  );

  const handleSearchSubmit = useCallback(() => {
    void runSubmittedSearch(query);
  }, [runSubmittedSearch, query]);

  // Shortcut chips run their category query straight away, so the driver sees
  // nearby stops with detour times without typing.
  const handleShortcut = useCallback(
    (shortcutQuery: string) => {
      void runSubmittedSearch(shortcutQuery);
    },
    [runSubmittedSearch],
  );

  // Compute the added drive time for each submitted result by routing through
  // it (inserted after the current target, same as onSelect) vs. the current
  // route's duration. Uses the origin snapshotted at submit time — depending
  // on the live searchCenter would restart this effect on every GPS tick and
  // the detours would never resolve ("calculating" forever).
  useEffect(() => {
    if (!submitted || alongRoute.length === 0 || !destination) return;
    const origin = submittedOriginRef.current;
    if (!origin) return;
    const baseSeconds = activeRoute?.summary.durationSeconds;
    if (baseSeconds == null) return;
    let cancelled = false;
    const gen = (detourGenRef.current += 1);
    setDetours({});
    const pending = waypoints.slice(currentLegIndex);
    const prefs = useSettingsStore.getState().routePreferences;
    void (async () => {
      const settled = await Promise.allSettled(
        alongRoute.map(async (r) => {
          const withNew = [...pending];
          const stop = { lat: r.lat, lng: r.lng, name: r.name };
          if (withNew.length > 0) withNew.splice(1, 0, stop);
          else withNew.push(stop);
          const routeWaypoints = [
            { lat: origin.lat, lng: origin.lng },
            ...withNew,
            { lat: destination.lat, lng: destination.lng },
          ];
          const routes = await computeRoute(routeWaypoints, costing, {
            avoidTolls: prefs.avoidTolls,
            avoidHighways: prefs.avoidHighways,
            avoidFerries: prefs.avoidFerries,
          });
          const duration = routes[0]?.summary.durationSeconds;
          return duration != null ? Math.max(0, duration - baseSeconds) : null;
        }),
      );
      if (cancelled || detourGenRef.current !== gen) return;
      const next: Record<string, number | null> = {};
      settled.forEach((entry, i) => {
        next[detourKey(alongRoute[i])] = entry.status === 'fulfilled' ? entry.value : null;
      });
      setDetours(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [submitted, alongRoute, activeRoute, waypoints, currentLegIndex, destination, costing]);

  // "Edit Search" from the submitted overview: drop the map pins/overview and
  // return to the editable list without losing the query or results.
  const handleEditSearch = useCallback(() => {
    setSubmitted(false);
    setShowAll(false);
    setDetours({});
    useMapStore.getState().setStopSearchMarkers([]);
    inputRef.current?.focus();
  }, []);

  const handleClose = useCallback(() => {
    Keyboard.dismiss();
    if (isListening) {
      ExpoSpeechRecognitionModule.stop();
      setIsListening(false);
    }
    useMapStore.getState().setStopSearchMarkers([]);
    useMapStore.getState().setPendingStopSelection(null);
    setSubmitted(false);
    setShowAll(false);
    setDetours({});
    onClose();
  }, [onClose, isListening]);

  const handleSelect = useCallback(
    (result: UnifiedSearchResult) => {
      Keyboard.dismiss();
      if (isListening) {
        ExpoSpeechRecognitionModule.stop();
        setIsListening(false);
      }
      useMapStore.getState().setStopSearchMarkers([]);
      useMapStore.getState().setPendingStopSelection(null);
      setSubmitted(false);
      setShowAll(false);
      setDetours({});
      onSelect(result);
      clearSearch();
    },
    [onSelect, isListening, clearSearch],
  );

  // Tapping a result pin on the map selects that result.
  useEffect(() => {
    if (!pendingStopSelection) return;
    const match = results.find(
      (r) =>
        Math.abs(r.lat - pendingStopSelection.lat) < 0.0001 &&
        Math.abs(r.lng - pendingStopSelection.lng) < 0.0001,
    );
    if (match) {
      useMapStore.getState().setPendingStopSelection(null);
      handleSelect(match);
    }
  }, [pendingStopSelection, results, handleSelect]);

  const renderItem = useCallback(
    ({ item }: { item: UnifiedSearchResult }) => {
      const detour = detours[detourKey(item)];
      const label = submitted ? detourLabel(detour) : null;
      // A long diversion reads as a warning, a short one as an easy add.
      const detourStyle =
        typeof detour === 'number' && detour > 300 ? styles.resultDetourLong : styles.resultDetour;
      return (
        <Pressable
          style={({ pressed }) => [styles.resultItem, pressed && styles.resultItemPressed]}
          onPress={() => handleSelect(item)}
          accessibilityRole="button"
          accessibilityLabel={label != null ? `${item.name}, ${label.toLowerCase()}` : item.name}
          accessibilityHint="Adds this place as a stop on your route"
        >
          <View style={styles.resultIcon}>
            <Ionicons name="location-outline" size={20} color={nav.accent} />
          </View>
          <View style={styles.resultTextContainer}>
            <Text style={styles.resultName} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={styles.resultSubtitle} numberOfLines={1}>
              {formatDistance(item.distanceKm * 1000)} · {item.subtitle}
            </Text>
            {label != null && (
              <Text style={detourStyle} numberOfLines={1}>
                {label}
              </Text>
            )}
          </View>
          <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.3)" />
        </Pressable>
      );
    },
    [handleSelect, styles, detours, submitted],
  );

  const renderSeparator = useCallback(() => <View style={styles.separator} />, []);

  const translateY = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [600, 0],
  });

  // Editing searches every match; the submitted overview lists the options
  // along the route, top three by default.
  const listData = submitted ? listedResults : results;

  if (!visible) return null;

  return (
    <View
      style={styles.overlay}
      pointerEvents={submitted ? 'box-none' : 'auto'}
      testID="add-destination-panel"
    >
      {/* While the search is being edited the backdrop keeps focus on the
          input; once results are submitted it clears so the zoomed-out route
          and the option pins underneath stay visible and interactive. */}
      {!submitted && (
        <TouchableOpacity style={styles.backdrop} onPress={handleClose} activeOpacity={1} />
      )}
      <View
        style={[styles.keyboardAvoid, keyboardHeight > 0 && { paddingBottom: keyboardHeight }]}
        pointerEvents="box-none"
      >
        <Animated.View
          style={[
            styles.panel,
            submitted && styles.panelSubmitted,
            { transform: [{ translateY }] },
          ]}
        >
          <GlassView material="regular" colorScheme="dark" style={styles.panelGlass} />
          {/* Drag handle */}
          <View style={styles.dragHandle} />

          {/* Search row */}
          <View style={styles.searchRow}>
            <View style={styles.searchInputContainer}>
              <Ionicons
                name="search"
                size={18}
                color="rgba(255,255,255,0.5)"
                style={styles.searchIcon}
              />
              <TextInput
                ref={inputRef}
                style={styles.searchInput}
                value={query}
                onChangeText={handleChangeText}
                onSubmitEditing={handleSearchSubmit}
                placeholder="Add a stop"
                placeholderTextColor="rgba(255,255,255,0.4)"
                autoCorrect={false}
                returnKeyType="search"
                selectionColor={nav.accent}
              />
              {query.length > 0 && (
                <TouchableOpacity onPress={() => handleChangeText('')} activeOpacity={0.7}>
                  <Ionicons name="close-circle" size={18} color="rgba(255,255,255,0.4)" />
                </TouchableOpacity>
              )}
            </View>

            <TouchableOpacity
              style={[styles.micButton, isListening && styles.micButtonActive]}
              onPress={toggleVoiceSearch}
              activeOpacity={0.7}
            >
              <Ionicons
                name={isListening ? 'mic' : 'mic-outline'}
                size={22}
                color={isListening ? nav.danger : nav.textPrimary}
              />
            </TouchableOpacity>

            <TouchableOpacity onPress={handleClose} activeOpacity={0.7}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>

          {!submitted && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.shortcutRow}
              keyboardShouldPersistTaps="handled"
              accessibilityRole="toolbar"
              accessibilityLabel="Add a nearby stop"
            >
              {ADD_STOP_SHORTCUTS.map((shortcut) => (
                <TouchableOpacity
                  key={shortcut.id}
                  style={styles.shortcutChip}
                  onPress={() => handleShortcut(shortcut.searchQuery)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`Find ${shortcut.label.toLowerCase()} along the route`}
                >
                  <Ionicons name={shortcut.icon} size={15} color={nav.accent} />
                  <Text style={styles.shortcutLabel}>{shortcut.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {submitted && alongRoute.length > 0 && (
            <TouchableOpacity
              style={styles.foundRow}
              onPress={handleEditSearch}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`${alongRoute.length} stops along your route, edit search`}
            >
              <Text style={styles.foundText}>
                {alongRoute.length} {alongRoute.length === 1 ? 'stop' : 'stops'} along your route
              </Text>
              <Text style={styles.editSearchText}>Edit Search</Text>
            </TouchableOpacity>
          )}

          {isListening && (
            <View style={styles.listeningBanner}>
              <ActivityIndicator color={nav.accent} />
              <Text style={styles.listeningText}>Listening...</Text>
            </View>
          )}

          {loading && !isListening && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator color={nav.accent} />
            </View>
          )}

          {!loading && results.length === 0 && query.trim().length >= 2 && !isListening && (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No results found</Text>
            </View>
          )}

          {results.length > 0 && (
            <FlatList
              data={listData}
              keyExtractor={(item, index) => `${item.lat}-${item.lng}-${index}`}
              keyboardShouldPersistTaps="handled"
              renderItem={renderItem}
              ItemSeparatorComponent={renderSeparator}
              style={[styles.resultsList, submitted && styles.resultsListSubmitted]}
              scrollEnabled={!submitted || showAll}
            />
          )}

          {submitted && orderedResults.length > COLLAPSED_RESULT_LIMIT && (
            <TouchableOpacity
              style={styles.showAllRow}
              onPress={() => setShowAll((value) => !value)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={showAll ? 'Show fewer options' : 'Show all options'}
            >
              <Text style={styles.showAllText}>
                {showAll ? 'Show fewer' : `Show all ${orderedResults.length}`}
              </Text>
              <Ionicons
                name={showAll ? 'chevron-up' : 'chevron-down'}
                size={16}
                color={nav.accent}
              />
            </TouchableOpacity>
          )}
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 100,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  keyboardAvoid: {
    justifyContent: 'flex-end',
  },
  panel: {
    backgroundColor: 'transparent',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
    paddingHorizontal: spacing.md,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 34 : spacing.lg,
    maxHeight: '75%',
  },
  /** Submitted overview: a compact card so the zoomed-out route stays visible. */
  panelSubmitted: {
    maxHeight: '60%',
  },
  panelGlass: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(28,28,45,0.72)',
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignSelf: 'center',
    marginBottom: 16,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  searchInputContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
    height: 44,
  },
  micButton: {
    width: 44,
    height: 44,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  micButtonActive: {
    backgroundColor: nav.dangerSubtle,
  },
  cancelText: {
    color: nav.accent,
    fontSize: 16,
    fontWeight: '500',
  },
  shortcutRow: {
    flexDirection: 'row',
    gap: 8,
    paddingBottom: 12,
  },
  shortcutChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  shortcutLabel: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  listeningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 20,
  },
  listeningText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
  },
  loadingContainer: {
    paddingVertical: 30,
    alignItems: 'center',
  },
  emptyContainer: {
    paddingVertical: 30,
    alignItems: 'center',
  },
  emptyText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 15,
  },
  foundRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 6,
    paddingHorizontal: 4,
  },
  foundText: {
    flex: 1,
    color: 'rgba(255,255,255,0.6)',
    fontSize: 14,
  },
  editSearchText: {
    color: nav.accent,
    fontSize: 14,
    fontWeight: '500',
  },
  resultsList: {
    maxHeight: 380,
  },
  resultsListSubmitted: {
    maxHeight: 260,
    flexShrink: 1,
  },
  showAllRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
  },
  showAllText: {
    color: nav.accent,
    fontSize: 14,
    fontWeight: '600',
  },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  resultItemPressed: {
    opacity: 0.7,
  },
  resultIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: nav.accentWash,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  resultTextContainer: {
    flex: 1,
    marginRight: 8,
  },
  resultName: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
    lineHeight: 22,
  },
  resultSubtitle: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
    marginTop: 2,
  },
  resultDetour: {
    color: nav.success,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 2,
  },
  resultDetourLong: {
    color: nav.warning,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 2,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginLeft: 48,
  },
});
