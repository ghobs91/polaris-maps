import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  ScrollView,
  StyleSheet,
  Platform,
  Alert,
  Keyboard,
  Animated,
  ActivityIndicator,
  Switch,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import * as FileSystem from 'expo-file-system';
import { useTheme } from '../../contexts/ThemeContext';
import { spacing, typography, borderRadius, shadow } from '../../constants/theme';
import { searchAddress, type GeocodingResult } from '../../services/geocoding/geocodingService';
import { searchByCategory } from '../../services/poi/categorySearchService';
import { useOsmPoiStore } from '../../stores/osmPoiStore';
import {
  getSearchHistory,
  addSearchHistory,
  removeSearchHistory,
} from '../../services/search/searchHistoryService';
import {
  getFavorites,
  setFavorite,
  type FavoriteLocation,
} from '../../services/favorites/favoritesService';
import { useMapStore } from '../../stores/mapStore';
import { useNavigationStore } from '../../stores/navigationStore';
import { computeRoute, initRouting } from '../../services/routing/routingService';
import { fetchRouteTrafficEta } from '../../services/traffic/tomtomRouteEta';
import {
  getRegionContainingPoint,
  getDownloadedRegions,
} from '../../services/regions/regionRepository';
import { extractTar } from '../../utils/archiveExtract';
import { getDatabase } from '../../services/database/init';
import { formatDistance } from '../../utils/units';
import type { OsmPoi } from '../../services/poi/osmFetcher';
import type { GeocodingEntry } from '../../models/geocoding';

/** Convert a category-search POI into the GeocodingResult shape the results list expects. */
function osmPoiToResult(poi: OsmPoi): GeocodingResult {
  const entry: GeocodingEntry = {
    id: poi.id,
    text: poi.name,
    type: 'place',
    housenumber: null,
    street: poi.tags['addr:street'] ?? null,
    city: poi.tags['addr:city'] ?? null,
    state: null,
    postcode: null,
    country: null,
    lat: poi.lat,
    lng: poi.lng,
  };
  return { entry, rank: 0 };
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
type PanelMode =
  | 'idle'
  | 'searching'
  | 'setting-home'
  | 'setting-work'
  | 'location'
  | 'route-preview';

interface FloatingSearchPanelProps {
  /** Extra bottom offset so it doesn't overlap the locate button */
  bottomInsetExtra?: number;
  /** Called when the user taps the profile/node-dashboard icon */
  onProfilePress?: () => void;
  /** Called when the user taps the locate/find-me button */
  onLocatePress?: () => void;
}

// ─────────────────────────────────────────────
// Map controls column — layers toggle + locate button anchored above the panel
// ─────────────────────────────────────────────
function LayersCardContent({
  trafficVisible,
  onTrafficToggle,
  isDark,
}: {
  trafficVisible: boolean;
  onTrafficToggle: (v: boolean) => void;
  isDark: boolean;
}) {
  const textColor = isDark ? '#EBEBF5' : '#1C1C1E';
  return (
    <>
      <Text style={[ctrlStyles.cardTitle, { color: textColor }]}>Map Layers</Text>
      <View style={ctrlStyles.cardRow}>
        <Ionicons name="car" size={18} color="#FF9500" style={ctrlStyles.cardRowIcon} />
        <Text style={[ctrlStyles.cardRowLabel, { color: textColor }]}>Traffic</Text>
        <Switch
          value={trafficVisible}
          onValueChange={onTrafficToggle}
          trackColor={{ false: '#767577', true: '#007AFF' }}
        />
      </View>
    </>
  );
}

function CtrlBtn({
  icon,
  onPress,
  isDark,
}: {
  icon: string;
  onPress: () => void;
  isDark: boolean;
}) {
  const iconColor = isDark ? '#EBEBF5' : '#1C1C1E';
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} style={ctrlStyles.btn}>
      <Ionicons name={icon as any} size={20} color={iconColor} />
    </TouchableOpacity>
  );
}

function MapControlsColumn({
  onLocatePress,
  isDark,
}: {
  onLocatePress?: () => void;
  isDark: boolean;
}) {
  const [layersOpen, setLayersOpen] = useState(false);
  const trafficLayerVisible = useMapStore((s) => s.trafficLayerVisible);
  const setTrafficLayerVisible = useMapStore((s) => s.setTrafficLayerVisible);
  const blurTint = isDark ? 'systemThickMaterialDark' : 'systemChromeMaterial';

  return (
    <View style={ctrlStyles.column}>
      {/* Layers popup — floats above the buttons */}
      {layersOpen &&
        (Platform.OS === 'ios' ? (
          <BlurView intensity={60} tint={blurTint} style={ctrlStyles.layersCard}>
            <LayersCardContent
              trafficVisible={trafficLayerVisible}
              onTrafficToggle={setTrafficLayerVisible}
              isDark={isDark}
            />
          </BlurView>
        ) : (
          <View
            style={[
              ctrlStyles.layersCard,
              { backgroundColor: isDark ? 'rgba(28,28,30,0.96)' : 'rgba(255,255,255,0.96)' },
            ]}
          >
            <LayersCardContent
              trafficVisible={trafficLayerVisible}
              onTrafficToggle={setTrafficLayerVisible}
              isDark={isDark}
            />
          </View>
        ))}

      {/* Stacked glass buttons */}
      {Platform.OS === 'ios' ? (
        <BlurView intensity={60} tint={blurTint} style={ctrlStyles.buttonsContainer}>
          <CtrlBtn isDark={isDark} icon="layers" onPress={() => setLayersOpen((v) => !v)} />
          <View style={ctrlStyles.separator} />
          <CtrlBtn isDark={isDark} icon="locate" onPress={() => onLocatePress?.()} />
        </BlurView>
      ) : (
        <View
          style={[
            ctrlStyles.buttonsContainer,
            { backgroundColor: isDark ? 'rgba(28,28,30,0.93)' : 'rgba(255,255,255,0.93)' },
          ]}
        >
          <CtrlBtn isDark={isDark} icon="layers" onPress={() => setLayersOpen((v) => !v)} />
          <View style={ctrlStyles.separator} />
          <CtrlBtn isDark={isDark} icon="locate" onPress={() => onLocatePress?.()} />
        </View>
      )}
    </View>
  );
}

const ctrlStyles = StyleSheet.create({
  column: {
    alignSelf: 'flex-end',
    alignItems: 'flex-end',
    marginBottom: 8,
    gap: 6,
  },
  buttonsContainer: {
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 10,
  },
  btn: {
    width: 46,
    height: 46,
    justifyContent: 'center',
    alignItems: 'center',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(120,120,128,0.3)',
    marginHorizontal: 10,
  },
  layersCard: {
    borderRadius: borderRadius.lg,
    paddingVertical: 12,
    paddingHorizontal: 16,
    minWidth: 190,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 10,
  },
  layersCardAndroid: {
    backgroundColor: 'rgba(255,255,255,0.96)',
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 10,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardRowIcon: {
    marginRight: 8,
  },
  cardRowLabel: {
    flex: 1,
    fontSize: 15,
  },
});

// ─────────────────────────────────────────────
// Glass container — renders BlurView on iOS, semi-transparent on Android
// ─────────────────────────────────────────────
function GlassPanel({
  children,
  style,
  isDark,
}: {
  children: React.ReactNode;
  style?: object;
  isDark: boolean;
}) {
  if (Platform.OS === 'ios') {
    return (
      <BlurView
        intensity={78}
        tint={isDark ? 'systemThickMaterialDark' : 'systemThickMaterial'}
        style={[styles.glassPanel, style]}
      >
        {children}
      </BlurView>
    );
  }
  return (
    <View
      style={[
        styles.glassPanel,
        {
          backgroundColor: isDark ? 'rgba(28,28,30,0.93)' : 'rgba(242,242,247,0.95)',
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

// ─────────────────────────────────────────────
// Favorite pill/icon button
// ─────────────────────────────────────────────
interface FavChipProps {
  icon: string;
  label: string;
  iconBg: string;
  subtitle?: string;
  onPress: () => void;
  onLongPress?: () => void;
  unset?: boolean;
  isDark: boolean;
}

function FavChip({
  icon,
  label,
  iconBg,
  subtitle,
  onPress,
  onLongPress,
  unset,
  isDark,
}: FavChipProps) {
  const textColor = isDark ? '#F2F2F7' : '#1C1C1E';
  const subColor = isDark ? '#8E8E93' : '#8E8E93';

  return (
    <TouchableOpacity
      onPress={onPress}
      onLongPress={onLongPress}
      activeOpacity={0.7}
      style={styles.favChip}
    >
      <View style={[styles.favIconCircle, { backgroundColor: iconBg, opacity: unset ? 0.55 : 1 }]}>
        <Ionicons name={icon as any} size={22} color="#fff" />
        {unset && (
          <View style={styles.favUnsetBadge}>
            <Ionicons name="add" size={10} color="#fff" />
          </View>
        )}
      </View>
      <Text style={[styles.favLabel, { color: textColor }]} numberOfLines={1}>
        {label}
      </Text>
      {subtitle ? (
        <Text style={[styles.favSub, { color: subColor }]} numberOfLines={1}>
          {subtitle}
        </Text>
      ) : null}
    </TouchableOpacity>
  );
}

// ─────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────
export function FloatingSearchPanel({
  bottomInsetExtra = 0,
  onProfilePress,
  onLocatePress,
}: FloatingSearchPanelProps) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const setViewport = useMapStore((s) => s.setViewport);
  const setSelectedLocation = useMapStore((s) => s.setSelectedLocation);
  const setFitBounds = useMapStore((s) => s.setFitBounds);
  const pendingDirectionsTarget = useMapStore((s) => s.pendingDirectionsTarget);
  const setPendingDirectionsTarget = useMapStore((s) => s.setPendingDirectionsTarget);
  const routePreview = useNavigationStore((s) => s.routePreview);
  const setRoutePreview = useNavigationStore((s) => s.setRoutePreview);
  const clearRoutePreview = useNavigationStore((s) => s.clearRoutePreview);
  const startNavigation = useNavigationStore((s) => s.startNavigation);
  const routePreviewTrafficEta = useNavigationStore((s) => s.routePreviewTrafficEta);

  const [mode, setMode] = useState<PanelMode>('idle');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodingResult[]>([]);
  const [history, setHistory] = useState<GeocodingResult[]>([]);
  const [favorites, setFavorites] = useState<FavoriteLocation[]>([]);
  const [selectedResult, setSelectedResult] = useState<GeocodingResult | null>(null);
  const [isRouting, setIsRouting] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [usedOnlineRouting, setUsedOnlineRouting] = useState(false);

  const inputRef = useRef<TextInput>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout>>();
  const fadeAnim = useRef(new Animated.Value(0)).current;

  // Track keyboard height so the panel stays above the keyboard
  const [keyboardHeight, setKeyboardHeight] = useState(0);
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

  // Load data on mount
  useEffect(() => {
    setHistory(getSearchHistory());
    setFavorites(getFavorites());
  }, []);

  // Animate results list in/out
  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: mode !== 'idle' ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [mode, fadeAnim]);

  // ── Search ──────────────────────────────────
  const handleQueryChange = useCallback(async (text: string) => {
    setQuery(text);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    if (text.length < 2) {
      setResults([]);
      useOsmPoiStore.getState().clearCategorySearch();
      return;
    }
    debounceTimer.current = setTimeout(async () => {
      // Resolve bounds: prefer live viewportBounds from the map, fall back to
      // a box derived from the mapStore viewport center + zoom so category search
      // always works even before the first onRegionDidChange fires.
      let bounds = useOsmPoiStore.getState().viewportBounds;
      if (!bounds) {
        const vp = useMapStore.getState().viewport;
        const delta = Math.min(2, (360 / Math.pow(2, vp.zoom)) * 2);
        bounds = {
          minLat: vp.lat - delta,
          minLng: vp.lng - delta,
          maxLat: vp.lat + delta,
          maxLng: vp.lng + delta,
        };
      }

      // Try category search first (local Overture data → Overpass fallback)
      useOsmPoiStore.getState().setIsCategorySearching(true);
      try {
        const catResult = await searchByCategory(
          text,
          bounds.minLat,
          bounds.minLng,
          bounds.maxLat,
          bounds.maxLng,
        );
        if (catResult && catResult.pois.length > 0) {
          useOsmPoiStore
            .getState()
            .setCategorySearch(catResult.categories, catResult.pois, catResult.localPrimary);
          // Show the nearby POIs in the dropdown list
          setResults(catResult.pois.map(osmPoiToResult));
          return;
        }
      } catch {
        // Category search failed — fall through to address-only search
      } finally {
        useOsmPoiStore.getState().setIsCategorySearching(false);
      }
      // No category match — standard geocoding search
      useOsmPoiStore.getState().clearCategorySearch();
      const found = await searchAddress(text, 10);
      setResults(found);
    }, 320);
  }, []);

  const handleFocus = useCallback(() => {
    if (mode === 'idle') setMode('searching');
  }, [mode]);

  const dismissSearch = useCallback(() => {
    Keyboard.dismiss();
    setMode('idle');
    setQuery('');
    setResults([]);
    useOsmPoiStore.getState().clearCategorySearch();
  }, []);

  // ── Dismiss location / route view ────────────
  const dismissLocation = useCallback(() => {
    setMode('idle');
    setSelectedResult(null);
    setSelectedLocation(null);
    clearRoutePreview();
    setRouteError(null);
    setUsedOnlineRouting(false);
  }, [setSelectedLocation, clearRoutePreview]);

  // ── Selecting a result ──────────────────────
  const navigateToResult = useCallback(
    (result: GeocodingResult) => {
      setViewport({ lat: result.entry.lat, lng: result.entry.lng, zoom: 16 });
      setSelectedLocation({
        lat: result.entry.lat,
        lng: result.entry.lng,
        name: result.entry.text,
      });
    },
    [setViewport, setSelectedLocation],
  );

  const handleSelectResult = useCallback(
    (result: GeocodingResult) => {
      if (mode === 'setting-home') {
        const fav: FavoriteLocation = {
          id: 'home',
          kind: 'home',
          label: 'Home',
          entry: result.entry,
        };
        setFavorite(fav);
        setFavorites(getFavorites());
        dismissSearch();
        navigateToResult(result);
        return;
      }
      if (mode === 'setting-work') {
        const fav: FavoriteLocation = {
          id: 'work',
          kind: 'work',
          label: 'Work',
          entry: result.entry,
        };
        setFavorite(fav);
        setFavorites(getFavorites());
        dismissSearch();
        navigateToResult(result);
        return;
      }
      // Normal search selection — show location detail view
      addSearchHistory(result);
      setHistory(getSearchHistory());
      Keyboard.dismiss();
      setQuery('');
      setResults([]);
      navigateToResult(result);
      setSelectedResult(result);
      setRouteError(null);
      setUsedOnlineRouting(false);
      clearRoutePreview();
      setMode('location');
    },
    [mode, dismissSearch, navigateToResult, clearRoutePreview],
  );

  // ── Routing ──────────────────────────────────
  const performDirections = useCallback(
    async (dest: { lat: number; lng: number; name: string }) => {
      setIsRouting(true);
      setRouteError(null);
      setUsedOnlineRouting(false);
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          setRouteError('Location permission required');
          return;
        }
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });

        const destRegion = await getRegionContainingPoint(dest.lat, dest.lng);
        const originRegion = await getRegionContainingPoint(
          pos.coords.latitude,
          pos.coords.longitude,
        );
        let region =
          (destRegion?.downloadStatus === 'complete' ? destRegion : null) ??
          (originRegion?.downloadStatus === 'complete' ? originRegion : null);
        if (!region) {
          const downloaded = await getDownloadedRegions();
          if (downloaded.length > 0) region = downloaded[0];
        }

        if (region) {
          const regionDir = `${FileSystem.documentDirectory}regions/${region.id}/`;
          const graphTilePath = `${regionDir}routing/`;
          const graphDirInfo = await FileSystem.getInfoAsync(graphTilePath);
          if (!graphDirInfo.exists) {
            const tarPath = `${regionDir}routing.tar`;
            const tarInfo = await FileSystem.getInfoAsync(tarPath);
            if (tarInfo.exists) {
              try {
                await extractTar(tarPath, graphTilePath);
                await FileSystem.deleteAsync(tarPath, { idempotent: true });
              } catch {
                // fall through to online routing
              }
            } else {
              const db = await getDatabase();
              await db.runAsync(
                'UPDATE regions SET download_status = ?, last_updated = ? WHERE id = ?',
                ['none', Math.floor(Date.now() / 1000), region.id],
              );
              await FileSystem.deleteAsync(regionDir, { idempotent: true });
              region = null;
            }
          }
          if (region) {
            try {
              await initRouting(`${FileSystem.documentDirectory}regions/${region.id}/routing/`);
            } catch {
              // fall through to online routing
            }
          }
        }

        const routes = await computeRoute(
          [{ lat: pos.coords.latitude, lng: pos.coords.longitude }, dest],
          'auto',
        );
        if (!routes.length) {
          setRouteError('No route found between these points');
          return;
        }
        if (!region) setUsedOnlineRouting(true);

        // Ensure selectedResult is populated so the route-preview panel renders
        setSelectedResult((prev) =>
          prev
            ? prev
            : {
                entry: {
                  id: 0,
                  text: dest.name,
                  type: 'place' as const,
                  housenumber: null,
                  street: null,
                  city: null,
                  state: null,
                  postcode: null,
                  country: null,
                  lat: dest.lat,
                  lng: dest.lng,
                },
                rank: 0,
              },
        );
        setRoutePreview(routes[0], routes.slice(1), dest, 'auto');
        if (routes[0].boundingBox) setFitBounds(routes[0].boundingBox);
        setMode('route-preview');

        // Fetch traffic-adjusted ETA in background
        fetchRouteTrafficEta(routes[0].geometry).then((result) => {
          if (result) {
            useNavigationStore.getState().setRoutePreviewTrafficEta(result.travelTimeSeconds);
          }
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setRouteError(msg || 'Could not compute route');
      } finally {
        setIsRouting(false);
      }
    },
    [setRoutePreview, setFitBounds],
  );

  const handleDirections = useCallback(async () => {
    if (!selectedResult) return;
    await performDirections({
      lat: selectedResult.entry.lat,
      lng: selectedResult.entry.lng,
      name: selectedResult.entry.text,
    });
  }, [selectedResult, performDirections]);

  // Handle directions triggered from the POI detail screen
  useEffect(() => {
    if (!pendingDirectionsTarget) return;
    const target = pendingDirectionsTarget;
    setPendingDirectionsTarget(null);
    performDirections(target);
  }, [pendingDirectionsTarget, setPendingDirectionsTarget, performDirections]);

  const handleStartNavigation = useCallback(() => {
    if (!routePreview) return;
    const { routePreviewAlternates, routePreviewDestination, routePreviewCosting } =
      useNavigationStore.getState();
    startNavigation(
      routePreview,
      routePreviewAlternates,
      routePreviewDestination,
      routePreviewCosting,
    );
    dismissLocation();
    router.push('/(tabs)/navigation');
  }, [routePreview, startNavigation, dismissLocation, router]);

  const handleAddPoi = useCallback(() => {
    if (!selectedResult) return;
    router.push({
      pathname: '/poi/edit',
      params: {
        lat: String(selectedResult.entry.lat),
        lng: String(selectedResult.entry.lng),
      },
    });
  }, [selectedResult, router]);

  // ── Favorites shortcuts ──────────────────────
  const homeEntry = favorites.find((f) => f.kind === 'home');
  const workEntry = favorites.find((f) => f.kind === 'work');
  const pinnedEntries = favorites.filter((f) => f.kind === 'pin');

  const handleHomeTap = useCallback(() => {
    if (homeEntry) {
      navigateToResult({ entry: homeEntry.entry, rank: 0 });
      setSelectedResult({ entry: homeEntry.entry, rank: 0 });
      setRouteError(null);
      setUsedOnlineRouting(false);
      clearRoutePreview();
      setMode('location');
    } else {
      setQuery('');
      setResults([]);
      setMode('setting-home');
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [homeEntry, navigateToResult, clearRoutePreview]);

  const handleWorkTap = useCallback(() => {
    if (workEntry) {
      navigateToResult({ entry: workEntry.entry, rank: 0 });
      setSelectedResult({ entry: workEntry.entry, rank: 0 });
      setRouteError(null);
      setUsedOnlineRouting(false);
      clearRoutePreview();
      setMode('location');
    } else {
      setQuery('');
      setResults([]);
      setMode('setting-work');
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [workEntry, navigateToResult, clearRoutePreview]);

  const handleHomeHold = useCallback(() => {
    if (!homeEntry) return;
    Alert.alert('Home', homeEntry.entry.text, [
      {
        text: 'Change Home',
        onPress: () => {
          setMode('setting-home');
          setTimeout(() => inputRef.current?.focus(), 80);
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [homeEntry]);

  const handleWorkHold = useCallback(() => {
    if (!workEntry) return;
    Alert.alert('Work', workEntry.entry.text, [
      {
        text: 'Change Work',
        onPress: () => {
          setMode('setting-work');
          setTimeout(() => inputRef.current?.focus(), 80);
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [workEntry]);

  // ── Derive placeholder ──────────────────────
  const placeholder = useMemo(() => {
    if (mode === 'setting-home') return 'Search for your home address…';
    if (mode === 'setting-work') return 'Search for your work address…';
    return 'Search';
  }, [mode]);

  // ── Styles ──────────────────────────────────
  const st = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  const panelBottom =
    keyboardHeight > 0 ? keyboardHeight + 12 : insets.bottom + 12 + bottomInsetExtra;
  const textColor = isDark ? '#F2F2F7' : '#1C1C1E';
  const subColor = '#8E8E93';

  // ── Render results list (search or history) ──
  const showResults = mode !== 'idle' && results.length > 0;
  const showHistory = mode === 'searching' && query.length < 2 && history.length > 0;

  const renderResultItem = useCallback(
    ({ item }: { item: GeocodingResult }) => (
      <TouchableOpacity
        style={st.resultRow}
        onPress={() => handleSelectResult(item)}
        activeOpacity={0.65}
      >
        <View style={st.resultIconWrap}>
          <Ionicons name="location-outline" size={18} color={colors.primary} />
        </View>
        <View style={st.resultText}>
          <Text style={[st.resultName, { color: textColor }]} numberOfLines={1}>
            {item.entry.text}
          </Text>
          <Text style={[st.resultSub, { color: subColor }]} numberOfLines={1}>
            {[item.entry.city, item.entry.state, item.entry.country].filter(Boolean).join(', ')}
          </Text>
        </View>
        <Ionicons name="arrow-back" size={15} color={subColor} />
      </TouchableOpacity>
    ),
    [st, colors, textColor, subColor, handleSelectResult],
  );

  const renderHistoryItem = useCallback(
    ({ item }: { item: GeocodingResult }) => (
      <TouchableOpacity
        style={st.resultRow}
        onPress={() => handleSelectResult(item)}
        activeOpacity={0.65}
      >
        <View style={st.resultIconWrap}>
          <Ionicons name="time-outline" size={18} color={subColor} />
        </View>
        <View style={st.resultText}>
          <Text style={[st.resultName, { color: textColor }]} numberOfLines={1}>
            {item.entry.text}
          </Text>
          <Text style={[st.resultSub, { color: subColor }]} numberOfLines={1}>
            {[item.entry.city, item.entry.state].filter(Boolean).join(', ')}
          </Text>
        </View>
        <TouchableOpacity
          hitSlop={10}
          onPress={() => {
            removeSearchHistory(item.entry.id);
            setHistory(getSearchHistory());
          }}
        >
          <Ionicons name="close-circle" size={18} color={subColor} />
        </TouchableOpacity>
      </TouchableOpacity>
    ),
    [st, textColor, subColor, handleSelectResult],
  );

  // ── Location detail view (Apple Maps style) ──
  if (mode === 'location' && selectedResult) {
    const entry = selectedResult.entry;
    const subtitle = [entry.city, entry.state, entry.country].filter(Boolean).join(', ');
    return (
      <View style={[styles.root, { bottom: panelBottom }]} pointerEvents="box-none">
        <MapControlsColumn isDark={isDark} onLocatePress={onLocatePress} />
        <GlassPanel isDark={isDark} style={st.panel}>
          <View style={styles.handle} />

          {/* Header row */}
          <View style={st.locHeader}>
            <View style={st.locTitleBlock}>
              <Text style={[st.locTitle, { color: textColor }]} numberOfLines={2}>
                {entry.text}
              </Text>
              {subtitle ? (
                <Text style={[st.locSubtitle, { color: subColor }]} numberOfLines={1}>
                  {subtitle}
                </Text>
              ) : null}
            </View>
            <TouchableOpacity onPress={dismissLocation} style={st.locCloseBtn} hitSlop={10}>
              <View
                style={[st.locCloseCircle, { backgroundColor: isDark ? '#3A3A3C' : '#E5E5EA' }]}
              >
                <Ionicons name="close" size={16} color={isDark ? '#EBEBF5' : '#3A3A3C'} />
              </View>
            </TouchableOpacity>
          </View>

          {/* Big Directions pill */}
          <View style={st.locActions}>
            <TouchableOpacity
              style={st.directionsBtn}
              onPress={handleDirections}
              disabled={isRouting}
              activeOpacity={0.85}
            >
              {isRouting ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Ionicons name="car" size={22} color="#fff" />
              )}
              <Text style={st.directionsBtnText}>{isRouting ? 'Routing…' : 'Directions'}</Text>
            </TouchableOpacity>
          </View>

          {routeError ? (
            <Text style={[st.routeError, { color: colors.error }]}>{routeError}</Text>
          ) : null}

          {/* Secondary actions */}
          <View style={st.locSecondaryRow}>
            <TouchableOpacity
              style={st.locSecondaryBtn}
              onPress={handleAddPoi}
              activeOpacity={0.75}
            >
              <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
              <Text style={[st.locSecondaryLabel, { color: colors.primary }]}>Add POI</Text>
            </TouchableOpacity>
          </View>
        </GlassPanel>
      </View>
    );
  }

  // ── Route preview view ────────────────────────
  if (mode === 'route-preview' && routePreview && selectedResult) {
    const entry = selectedResult.entry;
    const displayEtaSeconds = routePreviewTrafficEta ?? routePreview.summary.durationSeconds;
    return (
      <View style={[styles.root, { bottom: panelBottom }]} pointerEvents="box-none">
        <MapControlsColumn isDark={isDark} onLocatePress={onLocatePress} />
        <GlassPanel isDark={isDark} style={st.panel}>
          <View style={styles.handle} />

          {/* Header */}
          <View style={st.locHeader}>
            <View style={st.locTitleBlock}>
              <Text style={[st.locTitle, { color: textColor }]} numberOfLines={1}>
                {entry.text}
              </Text>
              <View style={st.routeSummaryRow}>
                <Ionicons name="time-outline" size={13} color={subColor} />
                <Text style={[st.routeSummaryText, { color: subColor }]}>
                  {formatDuration(displayEtaSeconds)}
                </Text>
                <Text style={[st.routeSummaryDot, { color: subColor }]}>·</Text>
                <Ionicons name="navigate-outline" size={13} color={subColor} />
                <Text style={[st.routeSummaryText, { color: subColor }]}>
                  {formatDistance(routePreview.summary.distanceMeters)}
                </Text>
              </View>
            </View>
            <TouchableOpacity onPress={dismissLocation} style={st.locCloseBtn} hitSlop={10}>
              <View
                style={[st.locCloseCircle, { backgroundColor: isDark ? '#3A3A3C' : '#E5E5EA' }]}
              >
                <Ionicons name="close" size={16} color={isDark ? '#EBEBF5' : '#3A3A3C'} />
              </View>
            </TouchableOpacity>
          </View>

          {usedOnlineRouting && (
            <TouchableOpacity
              style={st.regionHint}
              onPress={() => router.push('/regions')}
              activeOpacity={0.7}
            >
              <Ionicons name="cloud-download-outline" size={13} color={colors.warning} />
              <Text style={[st.regionHintText, { color: colors.warning }]}>
                Using online routing — download a region for offline use
              </Text>
            </TouchableOpacity>
          )}

          {/* Steps */}
          <FlatList
            data={routePreview.legs.flatMap((l) => l.maneuvers)}
            keyExtractor={(_, i) => String(i)}
            style={st.stepsList}
            renderItem={({ item, index }) => (
              <View style={st.stepRow}>
                <View
                  style={[
                    st.stepBadge,
                    { backgroundColor: isDark ? 'rgba(64,156,255,0.2)' : 'rgba(0,122,255,0.1)' },
                  ]}
                >
                  <Text style={[st.stepBadgeText, { color: colors.primary }]}>{index + 1}</Text>
                </View>
                <View style={st.stepContent}>
                  <Text style={[st.stepInstruction, { color: textColor }]} numberOfLines={2}>
                    {item.instruction}
                  </Text>
                  <Text style={[st.stepDistance, { color: subColor }]}>
                    {formatDistance(item.distanceMeters)}
                  </Text>
                </View>
              </View>
            )}
          />

          {/* Navigate CTA */}
          <View style={st.locActions}>
            <TouchableOpacity
              style={st.directionsBtn}
              onPress={handleStartNavigation}
              activeOpacity={0.85}
            >
              <Ionicons name="navigate" size={20} color="#fff" />
              <Text style={st.directionsBtnText}>Navigate</Text>
            </TouchableOpacity>
          </View>
        </GlassPanel>
      </View>
    );
  }

  // ── Search / idle panel ───────────────────────
  return (
    <View style={[styles.root, { bottom: panelBottom }]} pointerEvents="box-none">
      <MapControlsColumn isDark={isDark} onLocatePress={onLocatePress} />
      <GlassPanel isDark={isDark} style={st.panel}>
        {/* ── Handle bar ── */}
        <View style={styles.handle} />

        {/* ── Search row ── */}
        <View style={styles.searchRow}>
          <Ionicons name="search" size={18} color={subColor} style={styles.searchIcon} />
          <TextInput
            ref={inputRef}
            style={[styles.searchInput, { color: textColor }]}
            value={query}
            onChangeText={handleQueryChange}
            onFocus={handleFocus}
            placeholder={placeholder}
            placeholderTextColor={subColor}
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
          {mode !== 'idle' ? (
            <TouchableOpacity onPress={dismissSearch} hitSlop={10} style={styles.cancelBtn}>
              <Text style={[styles.cancelText, { color: colors.primary }]}>Cancel</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              onPress={onProfilePress ?? (() => router.push('/(tabs)/profile'))}
              activeOpacity={0.7}
              style={styles.profileBtn}
            >
              <View
                style={[styles.profileCircle, { backgroundColor: isDark ? '#3A3A3C' : '#D1D1D6' }]}
              >
                <Ionicons name="person" size={18} color={isDark ? '#EBEBF0' : '#3A3A3C'} />
              </View>
            </TouchableOpacity>
          )}
        </View>

        {/* ── Results / history ── */}
        {(showResults || showHistory) && (
          <Animated.View style={{ opacity: fadeAnim }}>
            <View style={st.divider} />
            <FlatList
              data={showHistory ? history : results}
              keyExtractor={(item) => String(item.entry.id)}
              renderItem={showHistory ? renderHistoryItem : renderResultItem}
              keyboardShouldPersistTaps="handled"
              scrollEnabled
              style={st.resultList}
              ListHeaderComponent={
                showHistory ? (
                  <Text style={[st.sectionHeader, { color: subColor }]}>Recents</Text>
                ) : null
              }
            />
          </Animated.View>
        )}

        {/* ── Idle: Favorites + Recents ── */}
        {mode === 'idle' && (
          <>
            {/* Favorites row */}
            <View style={st.divider} />
            <View style={st.sectionHeaderRow}>
              <Text style={[st.sectionTitle, { color: textColor }]}>Places</Text>
              <Ionicons name="chevron-forward" size={15} color={subColor} />
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.favRow}
            >
              <FavChip
                icon="home"
                label="Home"
                iconBg="#30C7E0"
                subtitle={homeEntry ? shorten(homeEntry.entry.text, 12) : undefined}
                onPress={handleHomeTap}
                onLongPress={handleHomeHold}
                unset={!homeEntry}
                isDark={isDark}
              />
              <FavChip
                icon="briefcase"
                label="Work"
                iconBg="#A47455"
                subtitle={workEntry ? shorten(workEntry.entry.text, 12) : undefined}
                onPress={handleWorkTap}
                onLongPress={handleWorkHold}
                unset={!workEntry}
                isDark={isDark}
              />
              {pinnedEntries.map((fav) => (
                <FavChip
                  key={fav.id}
                  icon="bookmark"
                  label={fav.label}
                  iconBg="#6246EA"
                  subtitle={shorten(fav.entry.text, 12)}
                  onPress={() => {
                    navigateToResult({ entry: fav.entry, rank: 0 });
                    setSelectedResult({ entry: fav.entry, rank: 0 });
                    setRouteError(null);
                    setUsedOnlineRouting(false);
                    clearRoutePreview();
                    setMode('location');
                  }}
                  isDark={isDark}
                />
              ))}
            </ScrollView>

            {/* Recents */}
            {history.length > 0 && (
              <>
                <View style={st.divider} />
                <View style={st.sectionHeaderRow}>
                  <Text style={[st.sectionTitle, { color: textColor }]}>Recents</Text>
                  <Ionicons name="chevron-forward" size={15} color={subColor} />
                </View>
                {history.slice(0, 10).map((item) => (
                  <TouchableOpacity
                    key={item.entry.id}
                    style={st.recentRow}
                    onPress={() => handleSelectResult(item)}
                    activeOpacity={0.65}
                  >
                    <View style={st.recentIcon}>
                      <Ionicons name="time-outline" size={18} color={subColor} />
                    </View>
                    <View style={st.resultText}>
                      <Text style={[st.resultName, { color: textColor }]} numberOfLines={1}>
                        {item.entry.text}
                      </Text>
                      <Text style={[st.resultSub, { color: subColor }]} numberOfLines={1}>
                        {[item.entry.city, item.entry.state].filter(Boolean).join(', ')}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </>
            )}
          </>
        )}

        {/* Setting-home/work header when no results yet */}
        {(mode === 'setting-home' || mode === 'setting-work') && !showResults && (
          <Animated.View style={{ opacity: fadeAnim }}>
            <View style={st.divider} />
            <Text style={[st.settingHint, { color: subColor }]}>
              {mode === 'setting-home'
                ? 'Type your home address to save it'
                : 'Type your work address to save it'}
            </Text>
          </Animated.View>
        )}
      </GlassPanel>
    </View>
  );
}

// ─────────────────────────────────────────────
// Helper
// ─────────────────────────────────────────────
function shorten(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

// ─────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────
const createStyles = (colors: ReturnType<typeof useTheme>['colors'], isDark: boolean) =>
  StyleSheet.create({
    panel: {
      ...shadow.lg,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)',
      marginHorizontal: spacing.md,
    },
    sectionHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
      paddingBottom: 2,
    },
    sectionTitle: {
      ...typography.subtitle,
      flex: 1,
    },
    sectionHeader: {
      ...typography.label,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
      paddingBottom: 4,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    resultList: {
      maxHeight: 300,
    },
    resultRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)',
    },
    recentRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 1,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)',
    },
    resultIconWrap: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)',
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: spacing.sm,
    },
    recentIcon: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)',
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: spacing.sm,
    },
    resultText: {
      flex: 1,
      marginRight: spacing.xs,
    },
    resultName: {
      ...typography.body,
      fontWeight: '500',
    },
    resultSub: {
      ...typography.caption,
      marginTop: 1,
    },
    settingHint: {
      ...typography.bodySmall,
      textAlign: 'center',
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.lg,
    },
    // ── Location detail styles ──
    locHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      paddingHorizontal: spacing.md,
      paddingTop: spacing.xs,
      paddingBottom: spacing.sm,
      gap: spacing.sm,
    },
    locTitleBlock: {
      flex: 1,
    },
    locTitle: {
      ...typography.h3,
      fontWeight: '700',
    },
    locSubtitle: {
      ...typography.caption,
      marginTop: 3,
    },
    locCloseBtn: {
      marginTop: 2,
    },
    locCloseCircle: {
      width: 28,
      height: 28,
      borderRadius: 14,
      justifyContent: 'center',
      alignItems: 'center',
    },
    locActions: {
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.sm,
    },
    directionsBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      backgroundColor: colors.primary,
      borderRadius: 999,
      paddingVertical: spacing.md - 2,
      paddingHorizontal: spacing.xl,
    },
    directionsBtnText: {
      ...typography.subtitle,
      color: '#fff',
      fontWeight: '700',
    },
    routeError: {
      ...typography.caption,
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.xs,
    },
    locSecondaryRow: {
      flexDirection: 'row',
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.md,
      gap: spacing.sm,
    },
    locSecondaryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingVertical: spacing.xs,
    },
    locSecondaryLabel: {
      ...typography.label,
    },
    routeSummaryRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      marginTop: 3,
    },
    routeSummaryText: {
      ...typography.caption,
      fontWeight: '600',
    },
    routeSummaryDot: {
      ...typography.caption,
    },
    regionHint: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.xs,
      marginHorizontal: spacing.md,
      marginBottom: spacing.xs,
    },
    regionHintText: {
      ...typography.caption,
      flex: 1,
    },
    stepsList: {
      maxHeight: 200,
      marginHorizontal: spacing.md,
      marginBottom: spacing.sm,
    },
    stepRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
      paddingVertical: spacing.xs,
    },
    stepBadge: {
      width: 22,
      height: 22,
      borderRadius: 11,
      justifyContent: 'center',
      alignItems: 'center',
      marginTop: 1,
    },
    stepBadgeText: {
      fontSize: 11,
      fontWeight: '700',
    },
    stepContent: {
      flex: 1,
    },
    stepInstruction: {
      ...typography.caption,
    },
    stepDistance: {
      ...typography.caption,
      fontSize: 11,
      marginTop: 1,
    },
  });

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    left: 12,
    right: 12,
  },
  glassPanel: {
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.25)',
    // iOS shadow via shadow* props
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 6 },
    // Android elevation
    elevation: 12,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(120,120,128,0.3)',
    marginTop: 8,
    marginBottom: 4,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
  },
  searchIcon: {
    marginRight: 6,
  },
  searchInput: {
    ...typography.body,
    flex: 1,
    fontSize: 17,
    paddingVertical: 4,
  },
  cancelBtn: {
    paddingLeft: spacing.sm,
  },
  cancelText: {
    ...typography.body,
    fontSize: 16,
  },
  profileBtn: {
    marginLeft: spacing.sm,
  },
  profileCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: 'center',
    alignItems: 'center',
  },
  favRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md - 4,
    paddingVertical: spacing.sm + 2,
    gap: 6,
  },
  favChip: {
    alignItems: 'center',
    width: 72,
    marginHorizontal: 4,
  },
  favIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 5,
  },
  favUnsetBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#8E8E93',
    justifyContent: 'center',
    alignItems: 'center',
  },
  favLabel: {
    ...typography.caption,
    fontSize: 11,
    fontWeight: '500',
    textAlign: 'center',
  },
  favSub: {
    fontSize: 10,
    textAlign: 'center',
    marginTop: 1,
  },
});
