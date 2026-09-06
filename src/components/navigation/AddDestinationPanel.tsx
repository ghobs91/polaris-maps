import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Animated,
  Platform,
  Keyboard,
  ActivityIndicator,
  Pressable,
  InteractionManager,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { unifiedSearch, type UnifiedSearchResult } from '../../services/search/unifiedSearch';
import { computeRoute } from '../../services/routing/routingService';
import { useNavigationStore } from '../../stores/navigationStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useMapStore } from '../../stores/mapStore';
import { decodePolyline } from '../../utils/polyline';
import { spacing } from '../../constants/theme';

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
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UnifiedSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  /** True after the user hits search — results stay visible with detour times + map pins. */
  const [submitted, setSubmitted] = useState(false);
  const [detours, setDetours] = useState<Record<string, number | null>>({});
  const slideAnim = useRef(new Animated.Value(0)).current;
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<TextInput>(null);
  const detourGenRef = useRef(0);
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

  // Animate panel in/out
  useEffect(() => {
    if (visible) {
      setQuery('');
      setResults([]);
      setSubmitted(false);
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
  }, [visible, slideAnim]);

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
      setQuery(transcript);
      performSearch(transcript);
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

  const performSearch = useCallback(
    async (text: string): Promise<UnifiedSearchResult[]> => {
      if (!text.trim()) {
        setResults([]);
        return [];
      }
      setLoading(true);
      try {
        const searchResults = await unifiedSearch(text, {
          lat: searchCenter.lat,
          lng: searchCenter.lng,
          zoom: 14,
          limit: 8,
          userLocation: searchCenter,
        });
        setResults(searchResults);
        return searchResults;
      } catch {
        setResults([]);
        return [];
      } finally {
        setLoading(false);
      }
    },
    [searchCenter],
  );

  const handleChangeText = useCallback(
    (text: string) => {
      setQuery(text);
      // New keystrokes invalidate the submitted overview — clear pins/detours
      // until the user hits search again.
      setSubmitted(false);
      setDetours({});
      useMapStore.getState().setStopSearchMarkers([]);
      if (searchTimeout.current) clearTimeout(searchTimeout.current);
      searchTimeout.current = setTimeout(() => {
        void performSearch(text);
      }, 350);
    },
    [performSearch],
  );

  // User hit search/submit: keep the list visible, drop pins for every result
  // on the map, and zoom out to the full route so they can pick a stop.
  const handleSearchSubmit = useCallback(async () => {
    if (searchTimeout.current) {
      clearTimeout(searchTimeout.current);
      searchTimeout.current = null;
    }
    const searchResults = await performSearch(query);
    if (searchResults.length === 0) return;
    Keyboard.dismiss();
    setSubmitted(true);
    // Freeze the origin for detour math — see submittedOriginRef.
    submittedOriginRef.current = { lat: searchCenter.lat, lng: searchCenter.lng };
    useMapStore
      .getState()
      .setStopSearchMarkers(searchResults.map((r) => ({ lat: r.lat, lng: r.lng, name: r.name })));
    // Fit the camera to the route + all results (MapView applies bottom
    // padding for the "search" mode so the sheet doesn't cover the pins).
    const coords: Array<[number, number]> = [];
    if (activeRoute?.geometry) {
      coords.push(...decodePolyline(activeRoute.geometry));
    }
    for (const r of searchResults) coords.push([r.lng, r.lat]);
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
      useMapStore.getState().setFitBounds([minLng, minLat, maxLng, maxLat], 'search');
    }
    onShowOnMap?.();
  }, [query, performSearch, activeRoute, onShowOnMap, searchCenter]);

  // Compute the added drive time for each submitted result by routing through
  // it (inserted after the current target, same as onSelect) vs. the current
  // route's duration. Uses the origin snapshotted at submit time — depending
  // on the live searchCenter would restart this effect on every GPS tick and
  // the detours would never resolve ("calculating" forever).
  useEffect(() => {
    if (!submitted || results.length === 0 || !destination) return;
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
        results.map(async (r) => {
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
        next[detourKey(results[i])] = entry.status === 'fulfilled' ? entry.value : null;
      });
      setDetours(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [submitted, results, activeRoute, waypoints, currentLegIndex, destination, costing]);

  const handleClose = useCallback(() => {
    Keyboard.dismiss();
    if (isListening) {
      ExpoSpeechRecognitionModule.stop();
      setIsListening(false);
    }
    useMapStore.getState().setStopSearchMarkers([]);
    useMapStore.getState().setPendingStopSelection(null);
    setSubmitted(false);
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
      setDetours({});
      onSelect(result);
      setQuery('');
      setResults([]);
    },
    [onSelect, isListening],
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
      const label = submitted ? detourLabel(detours[detourKey(item)]) : null;
      return (
        <Pressable
          style={({ pressed }) => [styles.resultItem, pressed && styles.resultItemPressed]}
          onPress={() => handleSelect(item)}
        >
          <View style={styles.resultIcon}>
            <Ionicons name="location-outline" size={20} color="#409CFF" />
          </View>
          <View style={styles.resultTextContainer}>
            <Text style={styles.resultName} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={styles.resultSubtitle} numberOfLines={1}>
              {item.subtitle}
            </Text>
            {label != null && (
              <Text style={styles.resultDetour} numberOfLines={1}>
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

  if (!visible) return null;

  return (
    <View style={styles.overlay} pointerEvents={visible ? 'auto' : 'none'}>
      <TouchableOpacity style={styles.backdrop} onPress={handleClose} activeOpacity={1} />
      <View style={[styles.keyboardAvoid, keyboardHeight > 0 && { paddingBottom: keyboardHeight }]}>
        <Animated.View style={[styles.panel, { transform: [{ translateY }] }]}>
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
                placeholder="Where to?"
                placeholderTextColor="rgba(255,255,255,0.4)"
                autoCorrect={false}
                returnKeyType="search"
                selectionColor="#409CFF"
              />
              {query.length > 0 && (
                <TouchableOpacity
                  onPress={() => {
                    setQuery('');
                    setResults([]);
                  }}
                  activeOpacity={0.7}
                >
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
                color={isListening ? '#EF4444' : '#fff'}
              />
            </TouchableOpacity>

            <TouchableOpacity onPress={handleClose} activeOpacity={0.7}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>

          {isListening && (
            <View style={styles.listeningBanner}>
              <ActivityIndicator color="#409CFF" />
              <Text style={styles.listeningText}>Listening...</Text>
            </View>
          )}

          {loading && !isListening && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator color="#409CFF" />
            </View>
          )}

          {!loading && results.length === 0 && query.trim().length >= 2 && !isListening && (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No results found</Text>
            </View>
          )}

          {results.length > 0 && (
            <FlatList
              data={results}
              keyExtractor={(item, index) => `${item.lat}-${item.lng}-${index}`}
              keyboardShouldPersistTaps="handled"
              renderItem={renderItem}
              ItemSeparatorComponent={renderSeparator}
              style={styles.resultsList}
            />
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
    backgroundColor: 'rgba(28,28,30,0.96)',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: spacing.md,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 34 : spacing.lg,
    maxHeight: '75%',
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
    backgroundColor: 'rgba(239,68,68,0.2)',
  },
  cancelText: {
    color: '#409CFF',
    fontSize: 16,
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
  resultsList: {
    maxHeight: 380,
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
    backgroundColor: 'rgba(64,156,255,0.14)',
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
    color: '#4ADE80',
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
