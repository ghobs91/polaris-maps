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
  PanResponder,
  InteractionManager,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import * as FileSystem from 'expo-file-system/legacy';
import { useTheme } from '../../contexts/ThemeContext';
import { spacing, typography, borderRadius } from '../../constants/theme';
import { GlassView } from '../common/GlassView';
import { type GeocodingResult } from '../../services/geocoding/geocodingService';
import { unifiedSearch, type UnifiedSearchResult } from '../../services/search/unifiedSearch';
import { isAbortError } from '../../services/search/abortUtils';
import { useOsmPoiStore } from '../../stores/osmPoiStore';
import { searchNearby, type NativeMapKitPoi } from '../../native/mapkit';
import {
  getSearchHistory,
  addSearchHistory,
  removeSearchHistory,
} from '../../services/search/searchHistoryService';
import {
  getFavorites,
  setFavorite,
  removeFavorite,
  type FavoriteLocation,
} from '../../services/favorites/favoritesService';
import { useMapStore } from '../../stores/mapStore';
import { useNavigationStore } from '../../stores/navigationStore';
import { useTransitStore } from '../../stores/transitStore';
import { computeRoute, initRouting } from '../../services/routing/routingService';
import type { ValhallaRoute } from '../../models/route';
import { planTransitTrip } from '../../services/transit/transitRoutingService';
import { fetchRouteTrafficEta } from '../../services/traffic/tomtomRouteEta';
import {
  getRegionContainingPoint,
  getDownloadedRegions,
} from '../../services/regions/regionRepository';
import { extractTar } from '../../utils/archiveExtract';
import { TransitDirectionsPanel } from './TransitDirectionsPanel';
import { TransportModeSelector, type TransportMode } from './TransportModeSelector';
import { CategoryPills } from './CategoryPills';
import { searchByCategory } from '../../services/poi/categorySearchService';
import { fetchOsmPoisByTags, type OsmPoi } from '../../services/poi/osmFetcher';
import {
  fetchChargingStations,
  type ChargingStation,
} from '../../services/poi/openChargeMapService';
import {
  categoryToOverpassTags,
  resolveSearchCategories,
} from '../../services/poi/categoryResolver';
import { searchOtpStops, fetchOtpRoutesAtStop } from '../../services/transit/otpEndpointRegistry';
import { formatDistance } from '../../utils/units';
import { shouldOfferParkAndRide, planParkAndRide } from '../../services/routing/parkAndRideService';
import { decodePolyline } from '../../utils/polyline';
import { useTrafficStore } from '../../stores/trafficStore';
import { fetchRouteTrafficImmediate } from '../../services/traffic/trafficFlowService';
import { useSettingsStore } from '../../stores/settingsStore';
import {
  averageRouteTrafficColor,
  ETA_COLOR_GREEN,
} from '../../services/traffic/routeTrafficService';
import type { GeocodingEntry } from '../../models/geocoding';
import type { ParkAndRideResult } from '../../services/routing/parkAndRideService';
import { destinationToGeocodingResult, isSameDestination } from './floatingSearchPanelHelpers';

/** Convert a UnifiedSearchResult into the GeocodingResult shape the results list expects. */
function unifiedToGeocodingResult(r: UnifiedSearchResult): GeocodingResult {
  const entry: GeocodingEntry = {
    id: r.poi?.id ?? Math.floor(Math.random() * 1e9),
    text: r.name,
    type: r.type === 'address' ? 'address' : 'place',
    housenumber: r.poi?.tags['addr:housenumber'] ?? null,
    street: r.poi?.tags['addr:street'] ?? null,
    city: r.city ?? r.poi?.tags['addr:city'] ?? null,
    state: r.poi?.tags['addr:state'] ?? null,
    postcode: r.poi?.tags['addr:postcode'] ?? null,
    country: r.poi?.tags['addr:country'] ?? null,
    lat: r.lat,
    lng: r.lng,
  };
  return { entry, rank: r.score, poi: r.poi };
}

/**
 * Convert a GeocodingEntry (e.g. a geocoded address) into the OsmPoi shape
 * the place card expects, so tapping a plain address result opens the full
 * place card instead of jumping straight to the directions panel.
 */
function geocodingEntryToOsmPoi(entry: GeocodingEntry): OsmPoi {
  return {
    // Negative ID space so the card's "Update Place Info" (OSM edit)
    // affordance is not offered for a plain geocoded address.
    id: -Math.max(1, Math.abs(entry.id)),
    lat: entry.lat,
    lng: entry.lng,
    name: entry.text,
    type: 'place',
    subtype: 'address',
    tags: {
      'polaris:source': 'geocode',
      'addr:full': entry.text,
      ...(entry.street ? { 'addr:street': entry.street } : {}),
      ...(entry.housenumber ? { 'addr:housenumber': entry.housenumber } : {}),
      ...(entry.city ? { 'addr:city': entry.city } : {}),
      ...(entry.state ? { 'addr:state': entry.state } : {}),
      ...(entry.postcode ? { 'addr:postcode': entry.postcode } : {}),
      ...(entry.country ? { 'addr:country': entry.country } : {}),
    },
  };
}

// ─────────────────────────────────────────────
// Open Charge Map → OsmPoi conversion helpers
// ─────────────────────────────────────────────

/**
 * Convert an Open Charge Map charging station to an OsmPoi for display
 * alongside OSM results on the map.
 */
function chargingStationToOsmPoi(station: ChargingStation): OsmPoi {
  const tags: Record<string, string> = {
    amenity: 'charging_station',
  };
  if (station.operator) tags['operator'] = station.operator;
  if (station.connections.length > 0) {
    tags['capacity'] = String(station.connections.length);
    tags['socket:type'] = station.connections.map((c) => c.type).join(';');
  }
  const maxPower = station.connections.reduce((max, c) => Math.max(max, c.powerKW ?? 0), 0);
  if (maxPower > 0) tags['charging:max_power'] = `${maxPower} kW`;

  return {
    // Use negative IDs to distinguish OCM-sourced POIs from OSM ones
    id: -station.id,
    lat: station.lat,
    lng: station.lng,
    name: station.name || 'EV Charging Station',
    type: 'amenity',
    subtype: 'charging_station',
    tags,
  };
}

/**
 * Merge OSM POIs with Open Charge Map POIs. Open Charge Map is the primary
 * source for charging stations — OSM duplicates within ~30m of an OCM station
 * are filtered out to avoid clutter.
 */
function mergeChargingPois(osmPois: OsmPoi[], ocmPois: OsmPoi[]): OsmPoi[] {
  if (ocmPois.length === 0) return osmPois;

  const DEDUP_THRESHOLD_KM = 0.03; // 30 meters
  // Filter out OSM stations that already exist in Open Charge Map
  const filteredOsm = osmPois.filter((osm) => {
    return !ocmPois.some((ocm) => {
      const dlat = osm.lat - ocm.lat;
      const dlng = osm.lng - ocm.lng;
      const dist = Math.sqrt(dlat * dlat + dlng * dlng) * 111; // approx km
      return dist < DEDUP_THRESHOLD_KM;
    });
  });

  // OCM results first — primary data source for charging stations
  return [...ocmPois, ...filteredOsm];
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/** Map Apple MKPointOfInterestCategory raw values to OSM-style subtypes for POI pill icons. */
function mapAppleCategory(category?: string): string {
  if (!category) return 'place';
  const map: Record<string, string> = {
    MKPOICategoryRestaurant: 'restaurant',
    MKPOICategoryCafe: 'cafe',
    MKPOICategoryBakery: 'bakery',
    MKPOICategoryNightlife: 'bar',
    MKPOICategoryGasStation: 'fuel',
    MKPOICategoryParking: 'parking',
    MKPOICategoryHospital: 'hospital',
    MKPOICategoryPharmacy: 'pharmacy',
    MKPOICategorySchool: 'school',
    MKPOICategoryUniversity: 'university',
    MKPOICategoryLibrary: 'library',
    MKPOICategoryMuseum: 'museum',
    MKPOICategoryTheater: 'theatre',
    MKPOICategoryPark: 'park',
    MKPOICategoryBeach: 'beach',
    MKPOICategoryStore: 'shop',
    MKPOICategoryGrocery: 'supermarket',
    MKPOICategoryFitnessCenter: 'fitness_centre',
    MKPOICategoryHotel: 'hotel',
    MKPOICategoryBank: 'bank',
    MKPOICategoryATM: 'atm',
    MKPOICategoryPostOffice: 'post_office',
    MKPOICategoryLaundry: 'laundry',
    MKPOICategoryCarRental: 'car_rental',
    MKPOICategoryAmusementPark: 'theme_park',
    MKPOICategoryAquarium: 'aquarium',
    MKPOICategoryZoo: 'zoo',
    MKPOICategoryMovieTheater: 'cinema',
  };
  return map[category] ?? 'place';
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function selectSearchFitPois(mapPois: OsmPoi[]): OsmPoi[] {
  if (mapPois.length <= 5) return mapPois;

  const fitPois = mapPois.slice(0, 5);
  const anchor = fitPois[0];
  let maxDistanceKm = 0;

  for (const poi of fitPois.slice(1)) {
    const latKm = Math.abs(poi.lat - anchor.lat) * 111;
    const lngKm =
      Math.abs(poi.lng - anchor.lng) * 111 * Math.cos(((poi.lat + anchor.lat) * Math.PI) / 360);
    maxDistanceKm = Math.max(maxDistanceKm, Math.hypot(latKm, lngKm));
  }

  // If one of the first results is still much farther out than the local cluster,
  // keep the map centered on the tighter group the user is likely scanning.
  if (maxDistanceKm > 18) {
    return fitPois.filter((poi) => {
      const latKm = Math.abs(poi.lat - anchor.lat) * 111;
      const lngKm =
        Math.abs(poi.lng - anchor.lng) * 111 * Math.cos(((poi.lat + anchor.lat) * Math.PI) / 360);
      return Math.hypot(latKm, lngKm) <= 12;
    });
  }

  return fitPois;
}

function boundsForPois(mapPois: OsmPoi[]): {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
} | null {
  if (mapPois.length === 0) return null;

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;

  for (const p of mapPois) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }

  const latPad = (maxLat - minLat) * 0.1 || 0.005;
  const lngPad = (maxLng - minLng) * 0.1 || 0.005;

  return {
    minLat: minLat - latPad,
    minLng: minLng - lngPad,
    maxLat: maxLat + latPad,
    maxLng: maxLng + lngPad,
  };
}

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
type PanelMode =
  | 'idle'
  | 'searching'
  | 'setting-home'
  | 'setting-work'
  | 'setting-pin'
  | 'location'
  | 'route-preview'
  | 'transit-preview';

interface FloatingSearchPanelProps {
  /** Extra bottom offset so it doesn't overlap the locate button */
  bottomInsetExtra?: number;
  /** Called when the user taps the profile/node-dashboard icon */
  onProfilePress?: () => void;
  /** Called when the user taps the locate/find-me button */
  onLocatePress?: () => void;
  /** When true, renders as an embedded panel (no absolute positioning, no map controls, no profile/bookmark buttons) */
  embedded?: boolean;
}

// ─────────────────────────────────────────────
// Map controls column — layers toggle + locate button anchored above the panel
// ─────────────────────────────────────────────
function LayersCardContent({
  trafficVisible,
  onTrafficToggle,
  transitVisible,
  onTransitToggle,
  isDark,
}: {
  trafficVisible: boolean;
  onTrafficToggle: (v: boolean) => void;
  transitVisible: boolean;
  onTransitToggle: (v: boolean) => void;
  isDark: boolean;
}) {
  const { colors } = useTheme();
  const textColor = isDark ? '#EBEBF5' : colors.text;
  const subtextColor = isDark ? '#A0A0B8' : colors.textSecondary;
  const chipBg = isDark ? '#3A3A58' : '#E5E5EA';
  const chipActiveBg = '#007AFF';
  const mapStyle = useMapStore((s) => s.mapStyle);
  const setMapStyle = useMapStore((s) => s.setMapStyle);

  return (
    <>
      <Text style={[ctrlStyles.cardTitle, { color: textColor }]}>Map Layers</Text>

      {/* Map type selector */}
      <Text style={[ctrlStyles.sectionLabel, { color: subtextColor }]}>Map Type</Text>
      <View style={ctrlStyles.chipRow}>
        <TouchableOpacity
          style={[
            ctrlStyles.chip,
            { backgroundColor: mapStyle === 'default' ? chipActiveBg : chipBg },
          ]}
          onPress={() => setMapStyle('default')}
          activeOpacity={0.7}
        >
          <Ionicons
            name="map-outline"
            size={15}
            color={mapStyle === 'default' ? '#FFF' : textColor}
          />
          <Text
            style={[ctrlStyles.chipLabel, { color: mapStyle === 'default' ? '#FFF' : textColor }]}
          >
            Default
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            ctrlStyles.chip,
            { backgroundColor: mapStyle === 'satellite' ? chipActiveBg : chipBg },
          ]}
          onPress={() => setMapStyle('satellite')}
          activeOpacity={0.7}
        >
          <Ionicons
            name="earth-outline"
            size={15}
            color={mapStyle === 'satellite' ? '#FFF' : textColor}
          />
          <Text
            style={[ctrlStyles.chipLabel, { color: mapStyle === 'satellite' ? '#FFF' : textColor }]}
          >
            Satellite
          </Text>
        </TouchableOpacity>
      </View>

      {/* Traffic toggle */}
      <View style={ctrlStyles.cardDivider} />
      <View style={ctrlStyles.cardRow}>
        <Ionicons name="car" size={18} color="#FF9500" style={ctrlStyles.cardRowIcon} />
        <Text style={[ctrlStyles.cardRowLabel, { color: textColor }]}>Traffic</Text>
        <Switch
          value={trafficVisible}
          onValueChange={onTrafficToggle}
          trackColor={{ false: '#555', true: '#007AFF' }}
        />
      </View>

      {/* Transit toggle */}
      <View style={ctrlStyles.cardDivider} />
      <View style={ctrlStyles.cardRow}>
        <Ionicons name="bus" size={18} color="#1A5BA5" style={ctrlStyles.cardRowIcon} />
        <Text style={[ctrlStyles.cardRowLabel, { color: textColor }]}>Transit</Text>
        <Switch
          value={transitVisible}
          onValueChange={onTransitToggle}
          trackColor={{ false: '#555', true: '#007AFF' }}
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
  const { colors } = useTheme();
  const iconColor = isDark ? '#EBEBF5' : colors.text;
  return (
    <GlassView material="regular" isInteractive style={ctrlStyles.btn}>
      <TouchableOpacity onPress={onPress} activeOpacity={0.7} style={ctrlStyles.btnInner}>
        <Ionicons name={icon as any} size={20} color={iconColor} />
      </TouchableOpacity>
    </GlassView>
  );
}

export function MapControlsColumn({
  onLocatePress,
  isDark,
}: {
  onLocatePress?: () => void;
  isDark: boolean;
}) {
  const [layersOpen, setLayersOpen] = useState(false);
  const trafficLayerVisible = useMapStore((s) => s.trafficLayerVisible);
  const setTrafficLayerVisible = useMapStore((s) => s.setTrafficLayerVisible);
  const transitLayerVisible = useTransitStore((s) => s.transitLayerVisible);
  const setTransitLayerVisible = useTransitStore((s) => s.setTransitLayerVisible);

  return (
    <View style={ctrlStyles.column}>
      {/* Layers popup — floats above the buttons */}
      {layersOpen && (
        <GlassView material="regular" style={ctrlStyles.layersCard}>
          <LayersCardContent
            trafficVisible={trafficLayerVisible}
            onTrafficToggle={setTrafficLayerVisible}
            transitVisible={transitLayerVisible}
            onTransitToggle={setTransitLayerVisible}
            isDark={isDark}
          />
        </GlassView>
      )}

      {/* Stacked floating glass buttons */}
      <CtrlBtn isDark={isDark} icon="layers" onPress={() => setLayersOpen((v) => !v)} />
      <CtrlBtn isDark={isDark} icon="locate" onPress={() => onLocatePress?.()} />
    </View>
  );
}

const ctrlStyles = StyleSheet.create({
  column: {
    alignSelf: 'flex-end',
    alignItems: 'flex-end',
    marginBottom: 8,
    gap: 8,
  },
  btn: {
    width: 46,
    height: 46,
    borderRadius: 999,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  btnInner: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  layersCard: {
    borderRadius: borderRadius.lg,
    borderCurve: 'continuous',
    paddingVertical: 12,
    paddingHorizontal: 16,
    minWidth: 190,
    overflow: 'hidden',
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '500',
    marginBottom: 5,
  },
  chipRow: {
    flexDirection: 'row' as const,
    gap: 7,
    marginBottom: 4,
  },
  chip: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: borderRadius.md,
    gap: 4,
  },
  chipLabel: {
    fontSize: 12,
    fontWeight: '500' as const,
  },
  cardDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(128,128,128,0.3)',
    marginVertical: 8,
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
// Glass container — wraps GlassView for regular floating panels
// ─────────────────────────────────────────────
function GlassPanel({ children, style }: { children: React.ReactNode; style?: object }) {
  return (
    <GlassView material="regular" style={[styles.glassPanel, style]}>
      {children}
    </GlassView>
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
  const { colors } = useTheme();
  const textColor = isDark ? '#F2F2F7' : colors.text;
  const subColor = isDark ? '#8E8E93' : colors.textSecondary;

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
  embedded = false,
}: FloatingSearchPanelProps) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const setViewport = useMapStore((s) => s.setViewport);
  const setSelectedLocation = useMapStore((s) => s.setSelectedLocation);
  const setFitBounds = useMapStore((s) => s.setFitBounds);
  const pendingDirectionsTarget = useMapStore((s) => s.pendingDirectionsTarget);
  const setPendingDirectionsTarget = useMapStore((s) => s.setPendingDirectionsTarget);
  const pendingSearchQuery = useMapStore((s) => s.pendingSearchQuery);
  const setPendingSearchQuery = useMapStore((s) => s.setPendingSearchQuery);
  const routePreview = useNavigationStore((s) => s.routePreview);
  const setRoutePreview = useNavigationStore((s) => s.setRoutePreview);
  const clearRoutePreview = useNavigationStore((s) => s.clearRoutePreview);
  const startNavigation = useNavigationStore((s) => s.startNavigation);
  const routePreviewTrafficEta = useNavigationStore((s) => s.routePreviewTrafficEta);
  const normalizedSegments = useTrafficStore((s) => s.normalizedSegments);

  const routePreviewEtaColor = useMemo(() => {
    if (!routePreview || normalizedSegments.length === 0) return ETA_COLOR_GREEN;
    const coords = decodePolyline(routePreview.geometry);
    return averageRouteTrafficColor(coords, normalizedSegments);
  }, [routePreview, normalizedSegments]);
  const routePreviewWaypoints = useNavigationStore((s) => s.routePreviewWaypoints);
  const setRoutePreviewWaypoints = useNavigationStore((s) => s.setRoutePreviewWaypoints);
  const transitDirectionsActive = useTransitStore((s) => s.directionsActive);
  const gtfsLoadingAgency = useTransitStore((s) => s.gtfsLoadingAgency);
  const transitLayerVisible = useTransitStore((s) => s.transitLayerVisible);
  const isLoadingLines = useTransitStore((s) => s.isLoadingLines);

  // Auto-dismiss loading banner after 15 seconds
  const loadingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (gtfsLoadingAgency) {
      loadingTimer.current = setTimeout(() => {
        useTransitStore.getState().setGtfsLoadingAgency(null);
      }, 15_000);
    }
    return () => {
      if (loadingTimer.current) clearTimeout(loadingTimer.current);
    };
  }, [gtfsLoadingAgency]);

  const [mode, setMode] = useState<PanelMode>('idle');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodingResult[]>([]);
  const [history, setHistory] = useState<GeocodingResult[]>([]);
  const [favorites, setFavorites] = useState<FavoriteLocation[]>([]);
  const [selectedResult, setSelectedResult] = useState<GeocodingResult | null>(null);
  const [isRouting, setIsRouting] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [isTransitRouting, setIsTransitRouting] = useState(false);
  const [recentsExpanded, setRecentsExpanded] = useState(false);
  const [transportMode, setTransportMode] = useState<TransportMode>('drive');
  const [showParkAndRide, setShowParkAndRide] = useState(false);
  const [parkAndRideResult, setParkAndRideResult] = useState<ParkAndRideResult | null>(null);
  const [showSearchThisArea, setShowSearchThisArea] = useState(false);
  const [addingStop, setAddingStop] = useState(false);
  const [stopSearchQuery, setStopSearchQuery] = useState('');
  const [stopSearchResults, setStopSearchResults] = useState<UnifiedSearchResult[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const searchAnchorRef = useRef<{ lat: number; lng: number } | null>(null);
  const categorySearchResults = useOsmPoiStore((s) => s.categorySearchResults);
  const isCategorySearching = useOsmPoiStore((s) => s.isCategorySearching);
  const pendingStopSelection = useMapStore((s) => s.pendingStopSelection);
  const setPendingStopSelection = useMapStore((s) => s.setPendingStopSelection);
  const setStopSearchMarkers = useMapStore((s) => s.setStopSearchMarkers);

  const viewport = useMapStore((s) => s.viewport);

  const inputRef = useRef<TextInput>(null);
  const stopSearchInputRef = useRef<TextInput>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Aborts the in-flight full search when a newer keystroke supersedes it. */
  const searchAbortRef = useRef<AbortController | null>(null);
  /** Incremented on every query change and on explicit clear; in-flight results
   * compare against this to detect staleness and discard themselves. */
  const searchGenRef = useRef(0);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  // ── Minimized state (drag-to-collapse, like Google/Apple Maps) ──
  const [minimized, setMinimized] = useState(false);
  const collapseAnim = useRef(new Animated.Value(1)).current; // 1 = expanded, 0 = collapsed
  // Stable refs so PanResponder (created once) can call latest versions
  const collapsePanelRef = useRef<() => void>(() => {});
  const expandPanelRef = useRef<() => void>(() => {});

  const expandPanel = useCallback(() => {
    setMinimized(false);
    Animated.spring(collapseAnim, {
      toValue: 1,
      useNativeDriver: false,
      tension: 80,
      friction: 12,
    }).start();
  }, [collapseAnim]);

  const collapsePanel = useCallback(() => {
    Keyboard.dismiss();
    setMinimized(true);
    Animated.spring(collapseAnim, {
      toValue: 0,
      useNativeDriver: false,
      tension: 80,
      friction: 12,
    }).start();
  }, [collapseAnim]);

  // Keep refs up to date
  useEffect(() => {
    collapsePanelRef.current = collapsePanel;
  }, [collapsePanel]);
  useEffect(() => {
    expandPanelRef.current = expandPanel;
  }, [expandPanel]);

  // Pan responder on the handle: swipe down > ~30px collapses, swipe up expands
  const handlePanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 5,
      onPanResponderRelease: (_, g) => {
        if (g.dy > 30) {
          collapsePanelRef.current();
        } else if (g.dy < -20) {
          expandPanelRef.current();
        }
      },
    }),
  ).current;

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

  // Show "Search this area" when the map is panned away from the last search location
  useEffect(() => {
    const anchor = searchAnchorRef.current;
    const hasResults = results.length > 0 || (categorySearchResults?.length ?? 0) > 0;
    if (!anchor || mode !== 'searching' || !hasResults || minimized || keyboardHeight > 0) {
      setShowSearchThisArea(false);
      return;
    }
    const dlat = viewport.lat - anchor.lat;
    const dlng = viewport.lng - anchor.lng;
    setShowSearchThisArea(Math.sqrt(dlat * dlat + dlng * dlng) > 0.015); // ~1.5 km
  }, [
    viewport.lat,
    viewport.lng,
    mode,
    results.length,
    categorySearchResults,
    minimized,
    keyboardHeight,
  ]);

  // ── Search ──────────────────────────────────
  const userLocationRef = useRef<{ lat: number; lng: number } | null>(null);

  const performSearch = useCallback(async (text: string, gen: number, signal: AbortSignal) => {
    const vp = useMapStore.getState().viewport;
    const vb = useOsmPoiStore.getState().viewportBounds;

    if (!userLocationRef.current) {
      void (async () => {
        try {
          const { status } = await Location.getForegroundPermissionsAsync();
          if (status !== 'granted') return;
          const pos = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          userLocationRef.current = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        } catch {
          // Ignore GPS failures during search.
        }
      })();
    }

    try {
      const [unified, otpStops, appleResults] = await Promise.all([
        unifiedSearch(text, {
          lat: vp.lat,
          lng: vp.lng,
          zoom: vp.zoom,
          limit: 20,
          viewportBounds: vb
            ? { south: vb.minLat, north: vb.maxLat, west: vb.minLng, east: vb.maxLng }
            : undefined,
          userLocation: userLocationRef.current ?? undefined,
          signal,
          // Render scored local results the moment the fast local phase
          // finishes; the awaited return replaces them with the full merge.
          onPartial: (partial) => {
            if (searchGenRef.current !== gen || signal.aborted) return;
            setResults(partial.map(unifiedToGeocodingResult));
          },
        }),
        searchOtpStops(text, vp.lat, vp.lng).catch(
          () => [] as Array<{ name: string; lat: number; lon: number; id: string }>,
        ),
        searchNearby(text, vp.lat, vp.lng, 15000).catch(() => [] as NativeMapKitPoi[]),
      ]);

      const stationResults: GeocodingResult[] = otpStops.map((s, i) => ({
        entry: {
          id: -(1_000_000 + i),
          text: s.name,
          type: 'station' as const,
          housenumber: null,
          street: null,
          city: null,
          state: null,
          postcode: null,
          country: null,
          lat: s.lat,
          lng: s.lon,
          otpStopId: s.id,
        },
        rank: 100 + i,
      }));

      const appleGeoResults: GeocodingResult[] = appleResults.map((r, i) => ({
        entry: {
          id: -(2_000_000 + i),
          text: r.name ?? text,
          type: 'place' as const,
          housenumber: r.subThoroughfare ?? null,
          street: r.thoroughfare ?? null,
          city: r.locality ?? null,
          state: r.administrativeArea ?? null,
          postcode: r.postalCode ?? null,
          country: r.country ?? null,
          lat: r.latitude,
          lng: r.longitude,
        },
        rank: 95 - i,
      }));

      const unifiedResults = unified.map(unifiedToGeocodingResult);
      const stationNames = new Set(stationResults.map((s) => s.entry.text.toLowerCase()));
      const filteredUnified = unifiedResults.filter(
        (r) => !stationNames.has(r.entry.text.toLowerCase()),
      );

      const filteredApple = appleGeoResults.filter((ar) => {
        return !filteredUnified.some(
          (ur) =>
            Math.abs(ur.entry.lat - ar.entry.lat) < 0.0005 &&
            Math.abs(ur.entry.lng - ar.entry.lng) < 0.0005 &&
            ur.entry.text.toLowerCase() === ar.entry.text.toLowerCase(),
        );
      });

      const displayedResults = [...stationResults, ...filteredApple, ...filteredUnified];
      const mapPois: OsmPoi[] = displayedResults
        .filter((result) => result.entry.type !== 'station')
        .map(
          (result) =>
            result.poi ?? {
              id: result.entry.id,
              lat: result.entry.lat,
              lng: result.entry.lng,
              name: result.entry.text,
              type: 'amenity',
              subtype: 'place',
              tags: {
                ...(result.entry.street ? { 'addr:street': result.entry.street } : {}),
                ...(result.entry.housenumber
                  ? { 'addr:housenumber': result.entry.housenumber }
                  : {}),
                ...(result.entry.city ? { 'addr:city': result.entry.city } : {}),
                ...(result.entry.state ? { 'addr:state': result.entry.state } : {}),
                ...(result.entry.postcode ? { 'addr:postcode': result.entry.postcode } : {}),
                ...(result.entry.country ? { 'addr:country': result.entry.country } : {}),
              },
            },
        );

      if (searchGenRef.current !== gen) return;
      setResults(displayedResults);

      if (mapPois.length > 0) {
        // Label the closest matches on the map and zoom the camera out to
        // frame them, matching Apple/Google Maps search behaviour. A small
        // subset is fitted (selectSearchFitPois) so one distant outlier
        // can't hijack the camera.
        const fitPois = selectSearchFitPois(mapPois);
        useOsmPoiStore.getState().setCategorySearch([], fitPois, false);

        const fitBounds = boundsForPois(fitPois);
        if (fitBounds) {
          useOsmPoiStore.getState().setZoomAndBounds(vp.zoom, fitBounds);
          useMapStore
            .getState()
            .setFitBounds(
              [fitBounds.minLng, fitBounds.minLat, fitBounds.maxLng, fitBounds.maxLat],
              'search',
            );
        }
      } else {
        useOsmPoiStore.getState().clearCategorySearch();
      }

      searchAnchorRef.current = { lat: vp.lat, lng: vp.lng };
    } catch (err) {
      // A superseded search leaves the UI alone — the newer search owns it.
      if (isAbortError(err)) return;
      if (searchGenRef.current === gen) {
        useOsmPoiStore.getState().clearCategorySearch();
        setResults([]);
      }
    } finally {
      if (searchGenRef.current === gen) {
        useOsmPoiStore.getState().setIsCategorySearching(false);
      }
    }
  }, []);

  const handleQueryChange = useCallback(
    (text: string) => {
      setQuery(text);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      // Supersede any in-flight search so it stops consuming network/CPU.
      searchAbortRef.current?.abort();
      const gen = ++searchGenRef.current;

      // Clear active category if user manually typed something different
      if (activeCategory && text !== activeCategory) {
        setActiveCategory(null);
      }

      if (text.length < 2) {
        setResults([]);
        useOsmPoiStore.getState().clearCategorySearch();
        return;
      }

      setResults([]);
      useOsmPoiStore.getState().clearCategorySearch();
      useOsmPoiStore.getState().setIsCategorySearching(true);

      // Phase A (no debounce): local-DB results render in milliseconds.
      const vp = useMapStore.getState().viewport;
      const vb = useOsmPoiStore.getState().viewportBounds;
      void unifiedSearch(text, {
        lat: vp.lat,
        lng: vp.lng,
        zoom: vp.zoom,
        limit: 20,
        viewportBounds: vb
          ? { south: vb.minLat, north: vb.maxLat, west: vb.minLng, east: vb.maxLng }
          : undefined,
        userLocation: userLocationRef.current ?? undefined,
        localOnly: true,
      })
        .then((partial) => {
          if (searchGenRef.current !== gen) return;
          setResults(partial.map(unifiedToGeocodingResult));
        })
        .catch(() => {
          // Local failures degrade to empty — the full search still runs.
        });

      // Phase B (debounced): full multi-source search with live local partials.
      debounceTimer.current = setTimeout(() => {
        const controller = new AbortController();
        searchAbortRef.current = controller;
        void performSearch(text, gen, controller.signal);
      }, 300);
    },
    [performSearch, activeCategory],
  );

  const handleSearchSubmit = useCallback(() => {
    const text = query.trim();
    if (text.length < 2) return;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    searchAbortRef.current?.abort();
    const gen = ++searchGenRef.current;
    setQuery(text);
    setResults([]);
    useOsmPoiStore.getState().clearCategorySearch();
    useOsmPoiStore.getState().setIsCategorySearching(true);
    const controller = new AbortController();
    searchAbortRef.current = controller;
    void performSearch(text, gen, controller.signal);
  }, [performSearch, query]);

  const handleFocus = useCallback(() => {
    if (mode === 'idle') setMode('searching');
  }, [mode]);

  const dismissSearch = useCallback(() => {
    Keyboard.dismiss();
    setMode('idle');
    setQuery('');
    setResults([]);
    setActiveCategory(null);
    searchAnchorRef.current = null;
    setShowSearchThisArea(false);
    // Abort the in-flight search and advance generation to discard stragglers.
    searchAbortRef.current?.abort();
    searchGenRef.current++;
    useOsmPoiStore.getState().clearCategorySearch();
  }, []);

  const handleSearchThisArea = useCallback(() => {
    setShowSearchThisArea(false);
    searchAnchorRef.current = null;
    handleQueryChange(query);
  }, [query, handleQueryChange]);

  // ── Dismiss location / route view ────────────
  const dismissLocation = useCallback(() => {
    setMode('idle');
    setSelectedResult(null);
    setSelectedLocation(null);
    clearRoutePreview();
    useTransitStore.getState().clearTransitPlan();
    setRouteError(null);
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
      if (mode === 'setting-pin') {
        // Prompt user for a label name
        Alert.prompt(
          'Name this place',
          result.entry.text,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Save',
              onPress: (label?: string) => {
                const trimmed = (label ?? '').trim();
                if (!trimmed) return;
                const fav: FavoriteLocation = {
                  id: `pin-${Date.now()}`,
                  kind: 'pin',
                  label: trimmed,
                  entry: result.entry,
                };
                setFavorite(fav);
                setFavorites(getFavorites());
                dismissSearch();
                navigateToResult(result);
              },
            },
          ],
          'plain-text',
          '',
          'default',
        );
        return;
      }
      // Normal search selection — show the place card for the selected result
      addSearchHistory(result);
      setHistory(getSearchHistory());
      Keyboard.dismiss();
      setQuery('');
      setResults([]);

      // Transit station — open the transit stop card directly
      if (result.entry.type === 'station') {
        navigateToResult(result);
        // Fetch routes from OTP so the stop card shows route badges + departures
        const otpId = result.entry.otpStopId;
        const routesPromise = otpId
          ? fetchOtpRoutesAtStop(otpId, result.entry.lat, result.entry.lng)
          : Promise.resolve([]);
        routesPromise
          .then((routes) => {
            useTransitStore.getState().setSelectedStop({
              name: result.entry.text,
              lat: result.entry.lat,
              lon: result.entry.lng,
              routes,
            });
          })
          .catch(() => {
            useTransitStore.getState().setSelectedStop({
              name: result.entry.text,
              lat: result.entry.lat,
              lon: result.entry.lng,
              routes: [],
            });
          });
        setMode('idle');
        return;
      }

      navigateToResult(result);

      // Always open the place card for a selected result. Directions are only
      // shown when the user taps the card's own Directions action (which sets
      // pendingDirectionsTarget and triggers performDirections below).
      const poi = result.poi ?? geocodingEntryToOsmPoi(result.entry);
      useOsmPoiStore.getState().setSelectedPoi(poi);
      setSelectedResult(null);
      setRouteError(null);
      clearRoutePreview();
      setMode('idle');
    },
    [mode, dismissSearch, navigateToResult, clearRoutePreview],
  );

  // ── Routing ──────────────────────────────────
  const performDirections = useCallback(
    async (
      dest: { lat: number; lng: number; name: string },
      costingOverride?: 'auto' | 'pedestrian',
    ) => {
      const costing = costingOverride ?? 'auto';
      setSelectedResult((prev) =>
        isSameDestination(prev, dest) ? prev : destinationToGeocodingResult(dest),
      );
      setMode('location');
      setIsRouting(true);
      setRouteError(null);
      setParkAndRideResult(null);
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

        let offlineInitialized = false;

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
            }
            // No routing tiles available for this region — keep region data intact, fall through to online
          }
          if (graphDirInfo.exists || (await FileSystem.getInfoAsync(graphTilePath)).exists) {
            try {
              await initRouting(graphTilePath);
              offlineInitialized = true;
            } catch {
              // fall through to online routing
            }
          }
        }

        const currentWaypoints = useNavigationStore.getState().routePreviewWaypoints;
        const allPoints = [
          { lat: pos.coords.latitude, lng: pos.coords.longitude },
          ...currentWaypoints,
          dest,
        ];

        const routePrefs = useSettingsStore.getState().routePreferences;
        let routes: ValhallaRoute[] = [];
        try {
          routes = await computeRoute(allPoints, costing, {
            avoidTolls: routePrefs.avoidTolls,
            avoidHighways: routePrefs.avoidHighways,
            avoidFerries: routePrefs.avoidFerries,
          });
        } catch (routeErr: unknown) {
          // If online routing failed and offline tiles exist but weren't initialized,
          // try harder to find and init any available offline tiles
          if (!offlineInitialized) {
            const downloaded = await getDownloadedRegions();
            for (const r of downloaded) {
              const rDir = `${FileSystem.documentDirectory}regions/${r.id}/`;
              const rGraphPath = `${rDir}routing/`;
              const rGraphInfo = await FileSystem.getInfoAsync(rGraphPath);
              if (!rGraphInfo.exists) continue;
              try {
                await initRouting(rGraphPath);
                routes = await computeRoute(allPoints, costing);
                break;
              } catch {
                // keep trying other regions
              }
            }
          }
          if (!routes.length) throw routeErr;
        }

        if (!routes.length) {
          setRouteError('No route found between these points');
          return;
        }

        setRoutePreview(routes[0], routes.slice(1), dest, costing, currentWaypoints);
        if (routes[0].boundingBox) setFitBounds(routes[0].boundingBox);
        setMode('route-preview');

        // Fetch traffic data along the route for color-coded segments
        const routeCoords = decodePolyline(routes[0].geometry);
        fetchRouteTrafficImmediate(routeCoords);

        // Check if park-and-ride should be offered (runs in background)
        shouldOfferParkAndRide(pos.coords.latitude, pos.coords.longitude)
          .then((result) => setShowParkAndRide(result.offered))
          .catch(() => setShowParkAndRide(false));

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

  // ── Transit Directions ───────────────────────
  const handleTransitDirections = useCallback(async () => {
    if (!selectedResult) return;
    setIsTransitRouting(true);
    setRouteError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setRouteError('Location permission required');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const origin = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      const dest = {
        lat: selectedResult.entry.lat,
        lng: selectedResult.entry.lng,
        name: selectedResult.entry.text,
      };

      const enabledModes = useTransitStore.getState().enabledModes;
      const timeState = useTransitStore.getState();
      const itineraries = await planTransitTrip({
        from: origin,
        to: dest,
        modes: timeState.enabledModes,
        departureTime: timeState.departureTime?.toISOString(),
        isDepartAt: timeState.isDepartAt,
      });

      if (itineraries.length === 0) {
        setRouteError('No transit routes found');
        return;
      }

      useTransitStore.getState().setTransitOrigin(origin);
      useTransitStore.getState().setTransitDestination(dest);
      useTransitStore.getState().setItineraries(itineraries);
      useTransitStore.getState().setTransitLayerVisible(true);

      // Fit map to first itinerary
      const it = itineraries[0];
      let minLat = 90,
        maxLat = -90,
        minLng = 180,
        maxLng = -180;
      for (const leg of it.legs) {
        for (const place of [leg.from, leg.to]) {
          if (place.lat < minLat) minLat = place.lat;
          if (place.lat > maxLat) maxLat = place.lat;
          if (place.lon < minLng) minLng = place.lon;
          if (place.lon > maxLng) maxLng = place.lon;
        }
      }
      setFitBounds([minLng, minLat, maxLng, maxLat]);
      setMode('transit-preview');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setRouteError(msg || 'Transit routing failed');
    } finally {
      setIsTransitRouting(false);
    }
  }, [selectedResult, setFitBounds]);

  // ── Park-and-ride routing ────────────────────
  const handleParkAndRide = useCallback(async () => {
    if (!selectedResult) return;
    setIsRouting(true);
    setRouteError(null);
    setParkAndRideResult(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setRouteError('Location permission required');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const result = await planParkAndRide(
        pos.coords.latitude,
        pos.coords.longitude,
        selectedResult.entry.lat,
        selectedResult.entry.lng,
      );
      setParkAndRideResult(result);

      // Show the driving leg on the map as route preview
      const dest = {
        lat: selectedResult.entry.lat,
        lng: selectedResult.entry.lng,
        name: selectedResult.entry.text,
      };
      setRoutePreview(result.drivingLeg, [], dest, 'auto');
      if (result.drivingLeg.boundingBox) setFitBounds(result.drivingLeg.boundingBox);
      setMode('route-preview');

      // Fetch traffic data for the park-and-ride driving leg
      const routeCoords = decodePolyline(result.drivingLeg.geometry);
      fetchRouteTrafficImmediate(routeCoords);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setRouteError(msg || 'Park & Ride routing failed');
    } finally {
      setIsRouting(false);
    }
  }, [selectedResult, setRoutePreview, setFitBounds]);

  // ── Transport mode change handler ──────────
  const handleTransportModeChange = useCallback(
    (newMode: TransportMode) => {
      setTransportMode(newMode);
      if (!selectedResult) return;
      const dest = {
        lat: selectedResult.entry.lat,
        lng: selectedResult.entry.lng,
        name: selectedResult.entry.text,
      };

      clearRoutePreview();
      setRouteError(null);
      setParkAndRideResult(null);

      switch (newMode) {
        case 'drive':
          performDirections(dest, 'auto');
          break;
        case 'walk':
          performDirections(dest, 'pedestrian');
          break;
        case 'transit':
          handleTransitDirections();
          break;
        case 'park-and-ride':
          handleParkAndRide();
          break;
      }
    },
    [
      selectedResult,
      performDirections,
      handleTransitDirections,
      handleParkAndRide,
      clearRoutePreview,
    ],
  );

  // Handle directions triggered from the POI detail screen
  useEffect(() => {
    if (!pendingDirectionsTarget) return;
    const target = pendingDirectionsTarget;
    setPendingDirectionsTarget(null);
    performDirections(target);
  }, [pendingDirectionsTarget, setPendingDirectionsTarget, performDirections]);

  // Handle search pre-fill triggered from My Places (place with no coordinates)
  useEffect(() => {
    if (!pendingSearchQuery) return;
    setPendingSearchQuery(null);
    setQuery(pendingSearchQuery);
    setMode('searching');
    handleQueryChange(pendingSearchQuery);
    setTimeout(() => inputRef.current?.focus(), 80);
  }, [pendingSearchQuery, setPendingSearchQuery, handleQueryChange]);

  // ── Waypoint management for multi-stop routing ──
  const rerouteWithWaypoints = useCallback(
    async (
      waypoints: Array<{ lat: number; lng: number; name?: string }>,
      destOverride?: { lat: number; lng: number; name: string },
    ) => {
      if (!selectedResult && !destOverride) return;
      const dest = destOverride ?? {
        lat: selectedResult!.entry.lat,
        lng: selectedResult!.entry.lng,
        name: selectedResult!.entry.text,
      };
      const costing = useNavigationStore.getState().routePreviewCosting;
      setIsRouting(true);
      setRouteError(null);
      try {
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        const allPoints = [
          { lat: pos.coords.latitude, lng: pos.coords.longitude },
          ...waypoints,
          dest,
        ];
        const routePrefs = useSettingsStore.getState().routePreferences;
        const routes = await computeRoute(allPoints, costing, {
          avoidTolls: routePrefs.avoidTolls,
          avoidHighways: routePrefs.avoidHighways,
          avoidFerries: routePrefs.avoidFerries,
        });
        if (!routes.length) {
          setRouteError('No route found');
          return;
        }
        setRoutePreview(routes[0], routes.slice(1), dest, costing, waypoints);
        if (routes[0].boundingBox) setFitBounds(routes[0].boundingBox);

        // Fetch traffic data along the rerouted path
        const routeCoords = decodePolyline(routes[0].geometry);
        fetchRouteTrafficImmediate(routeCoords);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setRouteError(msg || 'Could not compute route');
      } finally {
        setIsRouting(false);
      }
    },
    [selectedResult, setRoutePreview, setFitBounds],
  );

  const handleAddStop = useCallback(() => {
    setAddingStop(true);
    setStopSearchQuery('');
    setStopSearchResults([]);
  }, []);

  // Focus stop search input after layout settles (avoids lag from simultaneous re-render + keyboard)
  useEffect(() => {
    if (addingStop) {
      const handle = InteractionManager.runAfterInteractions(() => {
        stopSearchInputRef.current?.focus();
      });
      return () => handle.cancel();
    }
  }, [addingStop]);

  // Clear stop search markers when add-stop flow ends
  useEffect(() => {
    if (!addingStop) {
      setStopSearchMarkers([]);
    }
  }, [addingStop, setStopSearchMarkers]);

  const handleStopSearchChange = useCallback((text: string) => {
    setStopSearchQuery(text);
    if (text.length < 2) {
      setStopSearchResults([]);
      return;
    }
    const vp = useMapStore.getState().viewport;
    unifiedSearch(text, { lat: vp.lat, lng: vp.lng, zoom: vp.zoom, limit: 8 }).then(
      (results) => {
        // Sort by distance to route polyline if a route preview exists
        const preview = useNavigationStore.getState().routePreview;
        if (preview?.geometry) {
          const routeCoords = decodePolyline(preview.geometry);
          // Sample every Nth point for performance
          const step = Math.max(1, Math.floor(routeCoords.length / 50));
          const sampled = routeCoords.filter((_, i) => i % step === 0);
          const withDist = results.map((r) => {
            let minDist = Infinity;
            for (const [lng, lat] of sampled) {
              const dlat = r.lat - lat;
              const dlng = r.lng - lng;
              const d = dlat * dlat + dlng * dlng;
              if (d < minDist) minDist = d;
            }
            return { r, minDist };
          });
          withDist.sort((a, b) => a.minDist - b.minDist);
          setStopSearchResults(withDist.map((w) => w.r));
        } else {
          setStopSearchResults(results);
        }
      },
      () => {},
    );
  }, []);

  const handleStopSearchSubmit = useCallback(() => {
    if (stopSearchResults.length > 0) {
      setStopSearchMarkers(
        stopSearchResults.map((r) => ({ lat: r.lat, lng: r.lng, name: r.name })),
      );
      setStopSearchResults([]);
      Keyboard.dismiss();
    }
  }, [stopSearchResults, setStopSearchMarkers]);

  const handleSelectStop = useCallback(
    (result: UnifiedSearchResult) => {
      const wp = {
        lat: result.lat,
        lng: result.lng,
        name: result.name,
        subtitle: result.subtitle || result.city || undefined,
      };
      const updated = [...routePreviewWaypoints, wp];
      setRoutePreviewWaypoints(updated);
      setAddingStop(false);
      setStopSearchQuery('');
      setStopSearchResults([]);
      if (mode === 'route-preview') rerouteWithWaypoints(updated);
    },
    [routePreviewWaypoints, setRoutePreviewWaypoints, rerouteWithWaypoints, mode],
  );

  // Handle tap on a stop search marker on the map
  useEffect(() => {
    if (!pendingStopSelection || !addingStop) return;
    handleSelectStop({
      name: pendingStopSelection.name,
      lat: pendingStopSelection.lat,
      lng: pendingStopSelection.lng,
      type: 'place',
      score: 1,
    } as UnifiedSearchResult);
    setPendingStopSelection(null);
  }, [pendingStopSelection, addingStop, handleSelectStop, setPendingStopSelection]);

  const handleRemoveStop = useCallback(
    (index: number) => {
      const updated = routePreviewWaypoints.filter((_, i) => i !== index);
      setRoutePreviewWaypoints(updated);
      if (mode === 'route-preview') rerouteWithWaypoints(updated);
    },
    [routePreviewWaypoints, setRoutePreviewWaypoints, rerouteWithWaypoints, mode],
  );

  const handleMoveStop = useCallback(
    (fromIndex: number, direction: 'up' | 'down') => {
      const toIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1;
      if (toIndex < 0 || toIndex >= routePreviewWaypoints.length) return;
      const updated = [...routePreviewWaypoints];
      [updated[fromIndex], updated[toIndex]] = [updated[toIndex], updated[fromIndex]];
      setRoutePreviewWaypoints(updated);
      if (mode === 'route-preview') rerouteWithWaypoints(updated);
    },
    [routePreviewWaypoints, setRoutePreviewWaypoints, rerouteWithWaypoints, mode],
  );

  /**
   * Reorder the unified list of ALL destinations (intermediate stops + final).
   * If the final destination shifts position, selectedResult is updated accordingly.
   */
  const handleMoveAllDest = useCallback(
    (fromIndex: number, direction: 'up' | 'down') => {
      if (!selectedResult) return;
      const finalEntry = selectedResult.entry;
      const allDests = [
        ...routePreviewWaypoints,
        {
          lat: finalEntry.lat,
          lng: finalEntry.lng,
          name: finalEntry.text,
          subtitle: [finalEntry.city, finalEntry.state].filter(Boolean).join(', ') || undefined,
        },
      ];
      const toIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1;
      if (toIndex < 0 || toIndex >= allDests.length) return;
      const reordered = [...allDests];
      [reordered[fromIndex], reordered[toIndex]] = [reordered[toIndex], reordered[fromIndex]];

      const newWaypoints = reordered.slice(0, -1);
      const newFinal = reordered[reordered.length - 1];

      setRoutePreviewWaypoints(newWaypoints);

      // If the final destination changed, update selectedResult and location pin
      if (newFinal.lat !== finalEntry.lat || newFinal.lng !== finalEntry.lng) {
        const newResult = destinationToGeocodingResult({
          lat: newFinal.lat,
          lng: newFinal.lng,
          name: newFinal.name ?? '',
        });
        setSelectedResult(newResult);
        setSelectedLocation({ lat: newFinal.lat, lng: newFinal.lng, name: newFinal.name });
        if (mode === 'route-preview')
          rerouteWithWaypoints(newWaypoints, {
            lat: newFinal.lat,
            lng: newFinal.lng,
            name: newFinal.name ?? '',
          });
      } else {
        if (mode === 'route-preview') rerouteWithWaypoints(newWaypoints);
      }
    },
    [
      selectedResult,
      routePreviewWaypoints,
      setRoutePreviewWaypoints,
      setSelectedResult,
      setSelectedLocation,
      rerouteWithWaypoints,
      mode,
    ],
  );

  const handleStartNavigation = useCallback(() => {
    if (!routePreview) return;
    const {
      routePreviewAlternates,
      routePreviewDestination,
      routePreviewCosting,
      routePreviewWaypoints,
    } = useNavigationStore.getState();
    startNavigation(
      routePreview,
      routePreviewAlternates,
      routePreviewDestination,
      routePreviewCosting,
      routePreviewWaypoints,
    );
    dismissLocation();
    router.push('/(tabs)/navigation');
  }, [routePreview, startNavigation, dismissLocation, router]);

  // ── Favorites shortcuts ──────────────────────
  const homeEntry = favorites.find((f) => f.kind === 'home');
  const workEntry = favorites.find((f) => f.kind === 'work');
  const pinnedEntries = favorites.filter((f) => f.kind === 'pin');

  const handleHomeTap = useCallback(() => {
    if (homeEntry) {
      navigateToResult({ entry: homeEntry.entry, rank: 0 });
      setSelectedResult({ entry: homeEntry.entry, rank: 0 });
      setRouteError(null);
      clearRoutePreview();
      setMode('location');
    } else {
      // No address set yet — enter set-home search mode so the selected
      // result is saved as the Home address.
      setMode('setting-home');
      setQuery('');
      setResults([]);
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [homeEntry, navigateToResult, clearRoutePreview]);

  const handleWorkTap = useCallback(() => {
    if (workEntry) {
      navigateToResult({ entry: workEntry.entry, rank: 0 });
      setSelectedResult({ entry: workEntry.entry, rank: 0 });
      setRouteError(null);
      clearRoutePreview();
      setMode('location');
    } else {
      // No address set yet — enter set-work search mode so the selected
      // result is saved as the Work address.
      setMode('setting-work');
      setQuery('');
      setResults([]);
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
    if (mode === 'setting-pin') return 'Search for a place to save…';
    return 'Search';
  }, [mode]);

  // ── Styles ──────────────────────────────────
  const st = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  const panelBottom =
    keyboardHeight > 0 ? keyboardHeight + 12 : insets.bottom + 12 + bottomInsetExtra;

  const rootStyle = embedded
    ? [styles.rootEmbedded, st.embeddedRoot]
    : [styles.root, { bottom: panelBottom }];

  const textColor = isDark ? '#F2F2F7' : colors.text;
  const subColor = isDark ? '#8E8E93' : colors.textSecondary;

  // ── Render results list (search or history) ──
  const showResults =
    mode !== 'idle' &&
    (isCategorySearching || results.length > 0 || (categorySearchResults?.length ?? 0) > 0);
  const showHistory = mode === 'searching' && query.length < 2 && history.length > 0;

  const renderResultItem = useCallback(
    ({ item }: { item: GeocodingResult }) => {
      const isStation = item.entry.type === 'station';
      return (
        <TouchableOpacity
          style={st.resultRow}
          onPress={() => handleSelectResult(item)}
          activeOpacity={0.65}
        >
          <View style={st.resultIconWrap}>
            <Ionicons
              name={isStation ? 'train' : 'location-outline'}
              size={18}
              color={isStation ? '#007AFF' : colors.primary}
            />
          </View>
          <View style={st.resultText}>
            <Text style={[st.resultName, { color: textColor }]} numberOfLines={1}>
              {item.entry.text}
            </Text>
            <Text style={[st.resultSub, { color: subColor }]} numberOfLines={1}>
              {isStation
                ? 'Transit Station'
                : [item.entry.city, item.entry.state, item.entry.country]
                    .filter(Boolean)
                    .join(', ')}
            </Text>
          </View>
          <Ionicons name="arrow-back" size={15} color={subColor} />
        </TouchableOpacity>
      );
    },
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

  // Must be declared before any early returns so hooks are always called in the same order
  const handleFocusExpanding = useCallback(() => {
    if (minimized) expandPanel();
    handleFocus();
  }, [minimized, expandPanel, handleFocus]);

  // ── Hide when transit directions panel is active ──
  if (transitDirectionsActive) return null;

  // ── Location detail view (Apple Maps style) ──
  if (mode === 'location' && selectedResult) {
    const entry = selectedResult.entry;
    const subtitle = [entry.city, entry.state, entry.country].filter(Boolean).join(', ');
    return (
      <View style={rootStyle} pointerEvents="box-none">
        {!embedded && <MapControlsColumn isDark={isDark} onLocatePress={onLocatePress} />}
        <GlassPanel style={[st.panel, embedded && st.embeddedPanel]}>
          {/* Location header */}
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
              <GlassView material="clear" isInteractive style={st.locCloseCircle}>
                <Ionicons name="close" size={16} color={isDark ? '#EBEBF5' : '#3A3A3C'} />
              </GlassView>
            </TouchableOpacity>
          </View>

          {/* Transport mode selector */}
          <View style={{ paddingHorizontal: spacing.md }}>
            <TransportModeSelector
              selected={transportMode}
              onSelect={handleTransportModeChange}
              showParkAndRide={showParkAndRide}
              isDark={isDark}
            />
          </View>

          {/* Waypoints / stops (add before computing directions) */}
          <View style={styles.waypointSection}>
            {routePreviewWaypoints.map((wp, i) => (
              <View key={`wp-${i}`} style={styles.waypointRow}>
                <View style={styles.waypointDot}>
                  <Ionicons name="location" size={16} color={colors.primary} />
                </View>
                <Text style={[styles.waypointName, { color: textColor }]} numberOfLines={1}>
                  {wp.name ?? `Stop ${i + 1}`}
                </Text>
                <View style={styles.waypointActions}>
                  {i > 0 && (
                    <TouchableOpacity onPress={() => handleMoveStop(i, 'up')} hitSlop={8}>
                      <Ionicons name="chevron-up" size={18} color={subColor} />
                    </TouchableOpacity>
                  )}
                  {i < routePreviewWaypoints.length - 1 && (
                    <TouchableOpacity onPress={() => handleMoveStop(i, 'down')} hitSlop={8}>
                      <Ionicons name="chevron-down" size={18} color={subColor} />
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity onPress={() => handleRemoveStop(i)} hitSlop={8}>
                    <Ionicons name="close-circle" size={18} color={colors.error ?? '#FF3B30'} />
                  </TouchableOpacity>
                </View>
              </View>
            ))}
            {addingStop ? (
              <View style={styles.stopSearchWrap}>
                <TextInput
                  style={[styles.stopSearchInput, { color: textColor, borderColor: colors.border }]}
                  placeholder="Search for a stop…"
                  placeholderTextColor={subColor}
                  value={stopSearchQuery}
                  onChangeText={handleStopSearchChange}
                  ref={stopSearchInputRef}
                  returnKeyType="search"
                  onSubmitEditing={handleStopSearchSubmit}
                />
                {stopSearchResults.length > 0 && (
                  <View style={[styles.stopResultsList, { borderColor: colors.border }]}>
                    {stopSearchResults.slice(0, 5).map((r, i) => (
                      <TouchableOpacity
                        key={`stop-${i}`}
                        style={styles.stopResultRow}
                        onPress={() => handleSelectStop(r)}
                        activeOpacity={0.7}
                      >
                        <Ionicons name="location-outline" size={16} color={colors.primary} />
                        <View style={styles.stopResultInfo}>
                          <Text
                            style={[styles.stopResultText, { color: textColor }]}
                            numberOfLines={1}
                          >
                            {r.name}
                          </Text>
                          {r.subtitle || r.city ? (
                            <Text
                              style={[styles.stopResultSub, { color: subColor }]}
                              numberOfLines={1}
                            >
                              {r.subtitle || r.city}
                            </Text>
                          ) : null}
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
                <TouchableOpacity
                  onPress={() => {
                    setAddingStop(false);
                    setStopSearchQuery('');
                    setStopSearchResults([]);
                  }}
                  style={styles.stopCancelBtn}
                >
                  <Text style={{ color: colors.primary, fontSize: 13 }}>Cancel</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.addStopBtn}
                onPress={handleAddStop}
                activeOpacity={0.7}
              >
                <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
                <Text style={[styles.addStopText, { color: colors.primary }]}>Add stop</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Directions button */}
          <View style={st.locActions}>
            <TouchableOpacity
              style={st.directionsBtn}
              onPress={() => handleTransportModeChange(transportMode)}
              disabled={isRouting || isTransitRouting}
              activeOpacity={0.85}
            >
              {isRouting || isTransitRouting ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Ionicons name="navigate" size={20} color="#fff" />
              )}
              <Text style={st.directionsBtnText}>
                {isRouting || isTransitRouting ? 'Routing…' : 'Directions'}
              </Text>
            </TouchableOpacity>
          </View>

          {routeError ? (
            <Text style={[st.routeError, { color: colors.error }]}>{routeError}</Text>
          ) : null}
        </GlassPanel>
      </View>
    );
  }

  // ── Route preview view ────────────────────────
  if (mode === 'route-preview' && routePreview && selectedResult) {
    const entry = selectedResult.entry;
    const displayEtaSeconds = parkAndRideResult
      ? parkAndRideResult.totalDurationSeconds
      : (routePreviewTrafficEta ?? routePreview.summary.durationSeconds);

    return (
      <View style={rootStyle} pointerEvents="box-none">
        {!embedded && <MapControlsColumn isDark={isDark} onLocatePress={onLocatePress} />}
        <GlassPanel style={[st.panel, embedded && st.embeddedPanel]}>
          {!embedded && <View style={styles.handle} />}

          {/* Header */}
          <View style={st.locHeader}>
            <View style={st.locTitleBlock}>
              <Text style={[st.locTitle, { color: textColor }]} numberOfLines={1}>
                {entry.text}
              </Text>
              <View style={st.routeSummaryRow}>
                <Ionicons name="time-outline" size={13} color={routePreviewEtaColor} />
                <Text style={[st.routeSummaryText, { color: routePreviewEtaColor }]}>
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
              <GlassView material="clear" isInteractive style={st.locCloseCircle}>
                <Ionicons name="close" size={16} color={isDark ? '#EBEBF5' : '#3A3A3C'} />
              </GlassView>
            </TouchableOpacity>
          </View>

          {/* Transport mode selector */}
          <View style={{ paddingHorizontal: spacing.md }}>
            <TransportModeSelector
              selected={transportMode}
              onSelect={handleTransportModeChange}
              showParkAndRide={showParkAndRide}
              isDark={isDark}
            />
          </View>

          {/* Park-and-ride summary */}
          {parkAndRideResult && transportMode === 'park-and-ride' && (
            <View style={st.parkAndRideSummary}>
              <View style={st.parkAndRideLeg}>
                <Ionicons name="car" size={14} color={isDark ? '#409CFF' : '#007AFF'} />
                <Text style={[st.parkAndRideText, { color: textColor }]}>
                  Drive to {parkAndRideResult.stationName} (
                  {formatDuration(parkAndRideResult.drivingLeg.summary.durationSeconds)})
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={12} color={subColor} />
              <View style={st.parkAndRideLeg}>
                <Ionicons name="train" size={14} color={isDark ? '#409CFF' : '#007AFF'} />
                <Text style={[st.parkAndRideText, { color: textColor }]}>
                  Transit ({formatDuration(parkAndRideResult.transitLeg.duration)})
                </Text>
              </View>
            </View>
          )}

          {/* Waypoints / stops */}
          <View style={styles.waypointSection}>
            {[
              ...routePreviewWaypoints,
              {
                lat: entry.lat,
                lng: entry.lng,
                name: entry.text,
                subtitle: [entry.city, entry.state].filter(Boolean).join(', ') || undefined,
                isFinal: true,
              },
            ].map((wp, i, all) => (
              <View key={`wp-${i}`} style={styles.waypointRow}>
                <View style={styles.waypointDot}>
                  <Ionicons name="location" size={16} color={colors.primary} />
                </View>
                <View style={styles.waypointLabel}>
                  <Text style={[styles.waypointName, { color: textColor }]} numberOfLines={1}>
                    {wp.name ?? `Stop ${i + 1}`}
                  </Text>
                  {wp.subtitle ? (
                    <Text style={[styles.waypointSubtitle, { color: subColor }]} numberOfLines={1}>
                      {wp.subtitle}
                    </Text>
                  ) : null}
                </View>
                <View style={styles.waypointActions}>
                  {i > 0 && (
                    <TouchableOpacity onPress={() => handleMoveAllDest(i, 'up')} hitSlop={8}>
                      <Ionicons name="chevron-up" size={18} color={subColor} />
                    </TouchableOpacity>
                  )}
                  {i < all.length - 1 && (
                    <TouchableOpacity onPress={() => handleMoveAllDest(i, 'down')} hitSlop={8}>
                      <Ionicons name="chevron-down" size={18} color={subColor} />
                    </TouchableOpacity>
                  )}
                  {!('isFinal' in wp) && (
                    <TouchableOpacity onPress={() => handleRemoveStop(i)} hitSlop={8}>
                      <Ionicons name="close-circle" size={18} color={colors.error ?? '#FF3B30'} />
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            ))}
            {addingStop ? (
              <View style={styles.stopSearchWrap}>
                <TextInput
                  style={[styles.stopSearchInput, { color: textColor, borderColor: colors.border }]}
                  placeholder="Search for a stop…"
                  placeholderTextColor={subColor}
                  value={stopSearchQuery}
                  onChangeText={handleStopSearchChange}
                  ref={stopSearchInputRef}
                  returnKeyType="search"
                  onSubmitEditing={handleStopSearchSubmit}
                />
                {stopSearchResults.length > 0 && (
                  <View style={[styles.stopResultsList, { borderColor: colors.border }]}>
                    {stopSearchResults.slice(0, 5).map((r, i) => (
                      <TouchableOpacity
                        key={`stop-${i}`}
                        style={styles.stopResultRow}
                        onPress={() => handleSelectStop(r)}
                        activeOpacity={0.7}
                      >
                        <Ionicons name="location-outline" size={16} color={colors.primary} />
                        <View style={styles.stopResultInfo}>
                          <Text
                            style={[styles.stopResultText, { color: textColor }]}
                            numberOfLines={1}
                          >
                            {r.name}
                          </Text>
                          {r.subtitle || r.city ? (
                            <Text
                              style={[styles.stopResultSub, { color: subColor }]}
                              numberOfLines={1}
                            >
                              {r.subtitle || r.city}
                            </Text>
                          ) : null}
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
                <TouchableOpacity
                  onPress={() => {
                    setAddingStop(false);
                    setStopSearchQuery('');
                    setStopSearchResults([]);
                  }}
                  style={styles.stopCancelBtn}
                >
                  <Text style={{ color: colors.primary, fontSize: 13 }}>Cancel</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.addStopBtn}
                onPress={handleAddStop}
                activeOpacity={0.7}
              >
                <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
                <Text style={[styles.addStopText, { color: colors.primary }]}>Add stop</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Steps — hidden while searching for a stop so the panel fits on screen */}
          {!addingStop && (
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
          )}

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

  // ── Transit preview view ────────────────────
  if (mode === 'transit-preview') {
    return (
      <View style={rootStyle} pointerEvents="box-none">
        {!embedded && <MapControlsColumn isDark={isDark} onLocatePress={onLocatePress} />}
        <GlassPanel style={[st.panel, embedded && st.embeddedPanel]}>
          {!embedded && <View style={styles.handle} />}
          <TransitDirectionsPanel
            onClose={() => {
              useTransitStore.getState().clearTransitPlan();
              setMode('idle');
            }}
          />
        </GlassPanel>
      </View>
    );
  }

  // ── Minimized pill (Apple Maps style) ──────────
  if (minimized && !embedded) {
    return (
      <View style={[styles.root, { bottom: panelBottom }]} pointerEvents="box-none">
        <MapControlsColumn isDark={isDark} onLocatePress={onLocatePress} />
        {gtfsLoadingAgency && (
          <View style={styles.gtfsLoadingBanner} pointerEvents="none">
            <ActivityIndicator size="small" color="#FFFFFF" />
            <Text style={styles.gtfsLoadingText}>
              Loading transit data from {gtfsLoadingAgency}…
            </Text>
          </View>
        )}
        {transitLayerVisible && isLoadingLines && !gtfsLoadingAgency && (
          <View style={styles.gtfsLoadingBanner} pointerEvents="none">
            <ActivityIndicator size="small" color="#FFFFFF" />
            <Text style={styles.gtfsLoadingText}>Loading transit...</Text>
          </View>
        )}
        <View {...handlePanResponder.panHandlers}>
          {/* Subtle handle above the pill */}
          <View style={styles.miniHandleRow}>
            <View style={styles.miniHandle} />
          </View>
          <TouchableOpacity activeOpacity={0.85} onPress={expandPanel}>
            <GlassPanel style={styles.miniPill}>
              <Ionicons name="search" size={18} color={subColor} style={styles.miniSearchIcon} />
              <Text style={[styles.miniPlaceholder, { color: subColor }]}>Search</Text>
              <TouchableOpacity
                onPress={(e) => {
                  e.stopPropagation?.();
                  (onProfilePress ?? (() => router.push('/(tabs)/profile')))();
                }}
                activeOpacity={0.7}
                style={styles.miniProfileBtn}
              >
                <GlassView material="clear" isInteractive style={styles.miniProfileCircle}>
                  <Ionicons name="person" size={16} color="#EBEBF0" />
                </GlassView>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={(e) => {
                  e.stopPropagation?.();
                  router.push('/(tabs)/places');
                }}
                activeOpacity={0.7}
                style={styles.miniProfileBtn}
              >
                <GlassView material="clear" isInteractive style={styles.miniProfileCircle}>
                  <Ionicons name="bookmark" size={16} color="#EBEBF0" />
                </GlassView>
              </TouchableOpacity>
            </GlassPanel>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <>
      {!embedded && showSearchThisArea && (
        <View pointerEvents="box-none" style={[styles.searchThisAreaWrap, { top: insets.top + 8 }]}>
          <TouchableOpacity onPress={handleSearchThisArea} activeOpacity={0.85}>
            <GlassView material="regular" isInteractive style={styles.searchThisAreaBtn}>
              <Ionicons name="search" size={14} color={colors.text} />
              <Text style={[styles.searchThisAreaText, { color: colors.text }]}>
                Search this area
              </Text>
            </GlassView>
          </TouchableOpacity>
        </View>
      )}
      <View style={rootStyle} pointerEvents="box-none">
        {!embedded && <MapControlsColumn isDark={isDark} onLocatePress={onLocatePress} />}
        {gtfsLoadingAgency && (
          <View style={styles.gtfsLoadingBanner} pointerEvents="none">
            <ActivityIndicator size="small" color="#FFFFFF" />
            <Text style={styles.gtfsLoadingText}>
              Loading transit data from {gtfsLoadingAgency}…
            </Text>
          </View>
        )}
        {transitLayerVisible && isLoadingLines && !gtfsLoadingAgency && (
          <View style={styles.gtfsLoadingBanner} pointerEvents="none">
            <ActivityIndicator size="small" color="#FFFFFF" />
            <Text style={styles.gtfsLoadingText}>Loading transit...</Text>
          </View>
        )}

        {/* ── Category pills — floating quick search shortcuts ── */}
        {mode === 'idle' && !minimized && !embedded && (
          <CategoryPills
            activeCategory={activeCategory}
            loading={isCategorySearching}
            onCategoryPress={(categoryId, query) => {
              // Toggle off if already selected
              if (categoryId === activeCategory) {
                setActiveCategory(null);
                ++searchGenRef.current;
                useOsmPoiStore.getState().setIsCategorySearching(false);
                useOsmPoiStore.getState().clearCategorySearch();
                setResults([]);
                return;
              }

              setActiveCategory(categoryId);
              const gen = ++searchGenRef.current;
              setResults([]);
              useOsmPoiStore.getState().clearCategorySearch();

              const vp = useMapStore.getState().viewport;
              const vb = useOsmPoiStore.getState().viewportBounds;
              const south = vb?.minLat ?? vp.lat - 0.05;
              const north = vb?.maxLat ?? vp.lat + 0.05;
              const west = vb?.minLng ?? vp.lng - 0.05;
              const east = vb?.maxLng ?? vp.lng + 0.05;

              useOsmPoiStore.getState().setIsCategorySearching(true);

              // Resolve category to OSM tags and query Overpass directly
              const categories = resolveSearchCategories(query);
              if (!categories || categories.length === 0) {
                useOsmPoiStore.getState().setIsCategorySearching(false);
                useOsmPoiStore.getState().clearCategorySearch();
                return;
              }

              const tagPairs = categories.flatMap(categoryToOverpassTags);

              // Build promises for all data sources
              const fetches: Promise<OsmPoi[]>[] = [
                fetchOsmPoisByTags(south, west, north, east, tagPairs, undefined, {
                  requireName: false,
                }),
              ];

              // For EV charging, also query Open Charge Map for richer station data
              if (categories.includes('ev_charging')) {
                const centerLat = (south + north) / 2;
                const centerLng = (west + east) / 2;
                // Approximate viewport diagonal in km
                const dlat = (north - south) * 111;
                const dlng = (east - west) * 111 * Math.cos((centerLat * Math.PI) / 180);
                const radiusKm = Math.max(Math.sqrt(dlat * dlat + dlng * dlng) / 2, 3);

                fetches.push(
                  fetchChargingStations(centerLat, centerLng, radiusKm, 100)
                    .then((stations) => stations.map(chargingStationToOsmPoi))
                    .catch(() => [] as OsmPoi[]),
                );
              }

              Promise.all(fetches)
                .then((results) => {
                  if (searchGenRef.current !== gen) return;
                  useOsmPoiStore.getState().setIsCategorySearching(false);

                  // Merge results from all sources — OCM takes priority
                  let pois = results[0]; // OSM results
                  if (results.length > 1) {
                    pois = mergeChargingPois(pois, results[1]);
                  }

                  if (pois.length > 0) {
                    useOsmPoiStore.getState().setCategorySearch(
                      categories,
                      pois,
                      false, // not local primary
                    );
                    const fitPois = selectSearchFitPois(pois);
                    const fb = boundsForPois(fitPois);
                    if (fb && fitPois.length >= 2) {
                      useMapStore
                        .getState()
                        .setFitBounds([fb.minLng, fb.minLat, fb.maxLng, fb.maxLat], 'search');
                    }
                    searchAnchorRef.current = { lat: vp.lat, lng: vp.lng };
                  } else {
                    useOsmPoiStore.getState().clearCategorySearch();
                  }
                })
                .catch(() => {
                  if (searchGenRef.current === gen) {
                    useOsmPoiStore.getState().setIsCategorySearching(false);
                    useOsmPoiStore.getState().clearCategorySearch();
                  }
                });
            }}
          />
        )}

        <GlassPanel style={[st.panel, embedded && st.embeddedPanel]}>
          {/* ── Handle bar — drag down to minimize, drag up / tap to expand ── */}
          {!embedded && (
            <View
              {...handlePanResponder.panHandlers}
              style={styles.handleZone}
              hitSlop={{ top: 8, bottom: 8 }}
            >
              <View style={styles.handle} />
            </View>
          )}

          {/* ── Search row ── */}
          <View style={styles.searchRow}>
            <Ionicons name="search" size={18} color={subColor} style={styles.searchIcon} />
            <TextInput
              ref={inputRef}
              style={[styles.searchInput, { color: textColor }]}
              value={query}
              onChangeText={handleQueryChange}
              onFocus={handleFocusExpanding}
              onSubmitEditing={handleSearchSubmit}
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
            ) : !embedded ? (
              <View style={styles.headerButtons}>
                <TouchableOpacity
                  onPress={() => router.push('/(tabs)/places')}
                  activeOpacity={0.7}
                  style={styles.placesBtn}
                >
                  <GlassView material="clear" isInteractive style={styles.profileCircle}>
                    <Ionicons name="bookmark" size={18} color={isDark ? '#EBEBF0' : colors.text} />
                  </GlassView>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={onProfilePress ?? (() => router.push('/(tabs)/profile'))}
                  activeOpacity={0.7}
                  style={styles.profileBtn}
                >
                  <GlassView material="clear" isInteractive style={styles.profileCircle}>
                    <Ionicons name="person" size={18} color={isDark ? '#EBEBF0' : colors.text} />
                  </GlassView>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>

          {/* ── Body ── */}
          <>
            {/* ── Results / history ── */}
            {(showResults || showHistory) && (
              <Animated.View style={{ opacity: fadeAnim }}>
                <View style={st.divider} />
                <FlatList
                  data={
                    showHistory
                      ? history
                      : activeCategory && categorySearchResults?.length
                        ? categorySearchResults.map((poi) => ({
                            entry: {
                              id: poi.id,
                              text: poi.name,
                              type: 'place' as const,
                              housenumber: poi.tags['addr:housenumber'] ?? null,
                              street: poi.tags['addr:street'] ?? null,
                              city: poi.tags['addr:city'] ?? null,
                              state: poi.tags['addr:state'] ?? null,
                              postcode: poi.tags['addr:postcode'] ?? null,
                              country: poi.tags['addr:country'] ?? null,
                              lat: poi.lat,
                              lng: poi.lng,
                            },
                            rank: 50,
                            poi,
                          }))
                        : results
                  }
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
                  ListEmptyComponent={
                    !showHistory && isCategorySearching ? (
                      <View style={styles.searchLoadingRow}>
                        <ActivityIndicator color="#fff" size="small" />
                        <Text style={[styles.searchLoadingText, { color: textColor }]}>
                          Searching nearby...
                        </Text>
                      </View>
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
                        clearRoutePreview();
                        setMode('location');
                      }}
                      onLongPress={() => {
                        Alert.alert('Remove Place', `Remove "${fav.label}"?`, [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: 'Remove',
                            style: 'destructive',
                            onPress: () => {
                              removeFavorite(fav.id);
                              setFavorites(getFavorites());
                            },
                          },
                        ]);
                      }}
                      isDark={isDark}
                    />
                  ))}
                  <FavChip
                    icon="add"
                    label="Add Place"
                    iconBg="#8E8E93"
                    onPress={() => {
                      setMode('setting-pin');
                      setQuery('');
                      setResults([]);
                      Keyboard.dismiss();
                      setTimeout(() => inputRef.current?.focus(), 150);
                    }}
                    isDark={isDark}
                  />
                </ScrollView>

                {/* ── Saved Places link (embedded/sidebar mode only) ── */}
                {embedded && (
                  <TouchableOpacity
                    style={st.recentRow}
                    onPress={() => router.push('/(tabs)/places')}
                    activeOpacity={0.65}
                  >
                    <View style={st.recentIcon}>
                      <Ionicons name="bookmark" size={18} color={colors.primary} />
                    </View>
                    <View style={st.resultText}>
                      <Text style={[st.resultName, { color: textColor }]}>My Places</Text>
                      <Text style={[st.resultSub, { color: subColor }]}>
                        Saved places and guides
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={subColor} />
                  </TouchableOpacity>
                )}

                {/* Recents — collapsed to 1 item by default */}
                {history.length > 0 && (
                  <>
                    <View style={st.divider} />
                    <TouchableOpacity
                      style={st.sectionHeaderRow}
                      onPress={() => setRecentsExpanded((v) => !v)}
                      activeOpacity={0.7}
                    >
                      <Text style={[st.sectionTitle, { color: textColor }]}>Recents</Text>
                      <Ionicons
                        name={recentsExpanded ? 'chevron-down' : 'chevron-forward'}
                        size={15}
                        color={subColor}
                      />
                    </TouchableOpacity>
                    {(recentsExpanded ? history : history.slice(0, 1)).map((item) => (
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

            {/* Setting-home/work/pin header when no results yet */}
            {(mode === 'setting-home' || mode === 'setting-work' || mode === 'setting-pin') &&
              !showResults && (
                <Animated.View style={{ opacity: fadeAnim }}>
                  <View style={st.divider} />
                  <Text style={[st.settingHint, { color: subColor }]}>
                    {mode === 'setting-home'
                      ? 'Type your home address to save it'
                      : mode === 'setting-work'
                        ? 'Type your work address to save it'
                        : 'Search for a place, then give it a name'}
                  </Text>
                </Animated.View>
              )}
          </>
        </GlassPanel>
      </View>
    </>
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
      borderRadius: borderRadius.lg,
      overflow: 'hidden',
      borderCurve: 'continuous',
    },
    embeddedRoot: {
      flex: 1,
    },
    embeddedPanel: {
      flex: 1,
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
      borderRadius: 999,
      borderCurve: 'continuous',
      backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)',
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: spacing.sm,
    },
    recentIcon: {
      width: 32,
      height: 32,
      borderRadius: 999,
      borderCurve: 'continuous',
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
      borderRadius: 999,
      borderCurve: 'continuous',
      justifyContent: 'center',
      alignItems: 'center',
      overflow: 'hidden',
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
      borderCurve: 'continuous',
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
      borderRadius: 999,
      borderCurve: 'continuous',
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
    parkAndRideSummary: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginHorizontal: spacing.md,
      marginBottom: spacing.xs,
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.sm,
      borderRadius: borderRadius.md,
      borderCurve: 'continuous',
      backgroundColor: isDark ? 'rgba(64,156,255,0.1)' : 'rgba(0,122,255,0.06)',
    },
    parkAndRideLeg: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    parkAndRideText: {
      ...typography.caption,
      fontWeight: '500',
    },
  });

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    left: 12,
    right: 12,
  },
  rootEmbedded: {
    alignSelf: 'stretch',
  },
  searchThisAreaWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 999,
  },
  searchThisAreaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    borderCurve: 'continuous',
    paddingVertical: 9,
    paddingHorizontal: 18,
  },
  searchThisAreaText: {
    fontSize: 14,
    fontWeight: '600',
  },
  glassPanel: {
    borderRadius: 20,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(120,120,128,0.3)',
    marginTop: 8,
    marginBottom: 4,
  },
  handleZone: {
    // Larger tap/drag target around the handle pill
    paddingBottom: 4,
    alignItems: 'center',
  },
  // ── Minimized Apple Maps-style pill ──
  miniHandleRow: {
    alignItems: 'center',
    paddingBottom: 4,
  },
  miniHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(120,120,128,0.3)',
  },
  miniPill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    borderCurve: 'continuous',
    paddingVertical: 10,
    paddingLeft: 14,
    paddingRight: 6,
  },
  miniSearchIcon: {
    marginRight: 8,
  },
  miniPlaceholder: {
    flex: 1,
    fontSize: 17,
    fontWeight: '400',
  },
  miniProfileBtn: {
    marginLeft: 8,
  },
  miniProfileCircle: {
    width: 32,
    height: 32,
    borderRadius: 999,
    borderCurve: 'continuous',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
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
  searchLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  searchLoadingText: {
    ...typography.body,
    fontSize: 14,
  },
  cancelText: {
    ...typography.body,
    fontSize: 16,
  },
  profileBtn: {
    marginLeft: spacing.sm,
  },
  placesBtn: {
    marginLeft: spacing.sm,
  },
  headerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  profileCircle: {
    width: 34,
    height: 34,
    borderRadius: 999,
    borderCurve: 'continuous',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
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
    borderRadius: 999,
    borderCurve: 'continuous',
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
    borderRadius: 999,
    borderCurve: 'continuous',
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
  // ── Waypoint / multi-stop styles ──
  waypointSection: {
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  waypointRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    gap: 8,
  },
  waypointDot: {
    width: 20,
    alignItems: 'center',
  },
  waypointLabel: {
    flex: 1,
    justifyContent: 'center',
  },
  waypointName: {
    fontSize: 14,
    fontWeight: '500',
  },
  waypointSubtitle: {
    fontSize: 12,
    marginTop: 1,
  },
  waypointActions: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
  },
  addStopBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: borderRadius.md,
    borderCurve: 'continuous',
  },
  addStopText: {
    fontSize: 14,
    fontWeight: '500',
  },
  stopSearchWrap: {
    paddingVertical: 6,
  },
  stopSearchInput: {
    fontSize: 14,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderCurve: 'continuous',
  },
  stopResultsList: {
    marginTop: 4,
    borderRadius: 10,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  stopResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  stopResultInfo: {
    flex: 1,
  },
  stopResultText: {
    fontSize: 14,
  },
  stopResultSub: {
    fontSize: 12,
    marginTop: 1,
  },
  stopCancelBtn: {
    alignSelf: 'flex-end',
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  gtfsLoadingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(0,0,0,0.72)',
    borderRadius: 10,
    borderCurve: 'continuous',
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginBottom: 6,
    alignSelf: 'stretch',
  },
  gtfsLoadingText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '500',
  },
});
