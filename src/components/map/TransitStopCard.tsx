/**
 * TransitStopCard — Bottom-sheet departure card shown when tapping a
 * transit stop on the map.
 *
 * Styled to match the Google Maps transit stop card:
 *   • Station name + close button
 *   • Action buttons: Directions, Report delay, Details
 *   • Route badges (coloured circles with route ref)
 *   • Service alerts
 *   • Upcoming departures with headsign, time, "Live" / "Scheduled" label
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Animated,
  ActivityIndicator,
  Dimensions,
  Linking,
  TextInput,
  Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { useTheme } from '../../contexts/ThemeContext';
import { shadow } from '../../constants/theme';
import { useTransitStore } from '../../stores/transitStore';
import {
  fetchDepartures,
  type StopDepartureInfo,
  type Departure,
} from '../../services/transit/transitDepartureFetcher';
import {
  fetchRoutesAtStop,
  fetchStationOsmDetails,
  searchCachedStations,
  searchStationsOverpass,
  planLocalTransitRoute,
  localRouteToItinerary,
} from '../../services/transit/transitLineFetcher';
import { planTransitTrip } from '../../services/transit/transitRoutingService';
import { searchOtpStops } from '../../services/transit/otpEndpointRegistry';
import type { OtpItinerary, OtpLeg } from '../../models/transit';

const { height: SCREEN_H } = Dimensions.get('window');
const CARD_H = Math.min(SCREEN_H * 0.55, 480);
const CARD_H_DIRECTIONS = Math.min(SCREEN_H * 0.8, 680);

// ── Route badge ─────────────────────────────────────────────────────

function RouteBadge({ name, color, mode }: { name: string; color?: string; mode: string }) {
  const bg = color && /^[0-9A-Fa-f]{6}$/.test(color) ? `#${color}` : modeDefaultColor(mode);
  const textColor = isLightColor(bg) ? '#000000' : '#FFFFFF';

  return (
    <View style={[badgeStyles.badge, { backgroundColor: bg }]}>
      <Text style={[badgeStyles.text, { color: textColor }]} numberOfLines={1}>
        {name}
      </Text>
    </View>
  );
}

function modeDefaultColor(mode: string): string {
  switch (mode) {
    case 'SUBWAY':
      return '#1A5BA5';
    case 'RAIL':
      return '#E3470B';
    case 'TRAM':
      return '#D4A017';
    default:
      return '#666666';
  }
}

function isLightColor(hex: string): boolean {
  const c = hex.replace('#', '');
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150;
}

// ── Departure row ───────────────────────────────────────────────────

function DepartureRow({ departure }: { departure: Departure }) {
  const { colors } = useTheme();
  const badgeBg =
    departure.color && /^[0-9A-Fa-f]{6}$/.test(departure.color)
      ? `#${departure.color}`
      : modeDefaultColor(departure.mode);
  const badgeTextColor = isLightColor(badgeBg) ? '#000000' : '#FFFFFF';

  const timeLabel = departure.isRealtime ? 'Live' : 'Scheduled';
  const departureTime = new Date(departure.realtimeTime ?? departure.scheduledTime);
  const timeStr = departureTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  return (
    <View style={depStyles.row}>
      <View style={depStyles.left}>
        <View style={[depStyles.routeBadge, { backgroundColor: badgeBg }]}>
          <Text style={[depStyles.routeBadgeText, { color: badgeTextColor }]} numberOfLines={1}>
            {departure.routeName}
          </Text>
        </View>
        <View style={depStyles.info}>
          {departure.headsign ? (
            <Text style={[depStyles.headsign, { color: colors.text }]} numberOfLines={1}>
              {departure.headsign}
            </Text>
          ) : null}
          <Text style={[depStyles.timeLabel, { color: colors.textSecondary }]}>
            {timeLabel} · {timeStr}
          </Text>
        </View>
      </View>
      <View style={depStyles.right}>
        <Text style={[depStyles.minutes, { color: colors.text }]}>{departure.minutesAway}</Text>
        <Text style={[depStyles.minLabel, { color: colors.textSecondary }]}>min</Text>
      </View>
    </View>
  );
}

// ── Main card ───────────────────────────────────────────────────────

export function TransitStopCard() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const selectedStop = useTransitStore((s) => s.selectedStop);
  const setSelectedStop = useTransitStore((s) => s.setSelectedStop);

  const [departureInfo, setDepartureInfo] = useState<StopDepartureInfo | null>(null);
  const [loading, setLoading] = useState(false);

  // Station details panel state
  const [showDetails, setShowDetails] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [stationTags, setStationTags] = useState<Record<string, string> | null>(null);

  // Directions panel state
  const [showDirections, setShowDirections] = useState(false);
  const [destQuery, setDestQuery] = useState('');
  const [stationResults, setStationResults] = useState<
    Array<{ name: string; lat: number; lon: number }>
  >([]);
  const [selectedDest, setSelectedDest] = useState<{
    name: string;
    lat: number;
    lon: number;
  } | null>(null);
  const [dirItineraries, setDirItinerariesLocal] = useState<OtpItinerary[] | null>(null);
  const [selectedItinerary, setSelectedItineraryLocal] = useState<OtpItinerary | null>(null);

  // Wrappers that keep local state and transitStore in sync so ItineraryLayer renders on map
  const setDirItineraries = useCallback((its: OtpItinerary[] | null) => {
    setDirItinerariesLocal(its);
    const store = useTransitStore.getState();
    store.setItineraries(its ?? []);
  }, []);

  const setSelectedItinerary = useCallback(
    (it: OtpItinerary | null) => {
      setSelectedItineraryLocal(it);
      const store = useTransitStore.getState();
      if (it && dirItineraries) {
        const idx = dirItineraries.indexOf(it);
        if (idx >= 0) store.selectItinerary(idx);
      } else {
        store.selectItinerary(0);
      }
    },
    [dirItineraries],
  );
  const [dirLoading, setDirLoading] = useState(false);
  const [dirError, setDirError] = useState<string | null>(null);
  const overpassTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const destInputRef = useRef<TextInput>(null);

  const translateY = useRef(new Animated.Value(CARD_H)).current;

  // Animate in/out on selection change
  useEffect(() => {
    if (selectedStop) {
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        tension: 60,
        friction: 10,
      }).start();
    } else {
      Animated.timing(translateY, {
        toValue: CARD_H,
        duration: 200,
        useNativeDriver: true,
      }).start();
      setDepartureInfo(null);
      setShowDetails(false);
      setStationTags(null);
      setShowDirections(false);
      useTransitStore.getState().setDirectionsActive(false);
      setDestQuery('');
      setStationResults([]);
      setSelectedDest(null);
      setDirItineraries(null);
      setSelectedItinerary(null);
      setDirError(null);
    }
  }, [selectedStop, translateY]);

  const handleDetailsPress = useCallback(() => {
    setShowDetails(true);
    if (stationTags !== null || detailsLoading || !selectedStop) return;
    setDetailsLoading(true);
    fetchStationOsmDetails(selectedStop.lat, selectedStop.lon)
      .then((tags) => setStationTags(tags ?? {}))
      .catch(() => setStationTags({}))
      .finally(() => setDetailsLoading(false));
  }, [selectedStop, stationTags, detailsLoading]);

  // ── Directions handlers ─────────────────────────────────────────

  const handleDirectionsPress = useCallback(() => {
    setShowDirections(true);
    useTransitStore.getState().setDirectionsActive(true);
    setDestQuery('');
    setStationResults([]);
    setSelectedDest(null);
    setDirItineraries(null);
    setSelectedItinerary(null);
    setDirError(null);
    setTimeout(() => destInputRef.current?.focus(), 100);
  }, []);

  const planRoute = useCallback(
    async (destLat: number, destLng: number, destName?: string) => {
      if (!selectedStop) return;

      Keyboard.dismiss();
      setDirLoading(true);
      setDirError(null);

      // Try OTP first (registry auto-selects endpoint by coordinates);
      // fall back to local cached-line planner only if OTP fails.
      try {
        const itineraries = await planTransitTrip({
          from: { lat: selectedStop.lat, lng: selectedStop.lon },
          to: { lat: destLat, lng: destLng },
          modes: useTransitStore.getState().enabledModes,
        });
        setDirItineraries(itineraries);
        if (itineraries.length === 0) setDirError('No transit routes found');
        setDirLoading(false);
        return;
      } catch {
        // OTP unavailable — fall through to local planner
      }

      // Local planner using cached transit line data
      try {
        const localRoutes = planLocalTransitRoute(
          selectedStop.lat,
          selectedStop.lon,
          selectedStop.name,
          destLat,
          destLng,
          destName,
        );
        if (localRoutes.length === 0) {
          setDirError('No direct routes found between these stations');
          setDirItineraries(null);
        } else {
          setDirItineraries(localRoutes.map(localRouteToItinerary));
        }
      } finally {
        setDirLoading(false);
      }
    },
    [selectedStop],
  );

  const handleStationSelect = useCallback(
    (station: { name: string; lat: number; lon: number }) => {
      setSelectedDest(station);
      setDestQuery(station.name);
      setStationResults([]);
      planRoute(station.lat, station.lon, station.name);
    },
    [planRoute],
  );

  const handleLocationSelect = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setDirError('Location permission required');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const dest = {
        name: 'Your location',
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
      };
      setSelectedDest(dest);
      setDestQuery('Your location');
      setStationResults([]);
      planRoute(dest.lat, dest.lon, undefined);
    } catch {
      setDirError('Could not determine your location');
    }
  }, [planRoute]);

  const handleDestQueryChange = useCallback(
    (text: string) => {
      setDestQuery(text);
      setSelectedDest(null);
      setDirItineraries(null);
      setSelectedItinerary(null);
      setDirError(null);

      // Instant: search the Overpass tile cache
      const cached = searchCachedStations(text);
      setStationResults(cached);

      if (overpassTimerRef.current) clearTimeout(overpassTimerRef.current);
      if (text.length >= 2 && selectedStop) {
        overpassTimerRef.current = setTimeout(async () => {
          // Try OTP stops index first (covers entire transit network)
          const otpResults = await searchOtpStops(text, selectedStop.lat, selectedStop.lon);

          // Merge with cached results
          const combined = [...cached];
          const seen = new Set(cached.map((s) => `${s.name}:${s.lat.toFixed(3)}`));
          for (const s of otpResults) {
            const key = `${s.name}:${s.lat.toFixed(3)}`;
            if (!seen.has(key)) {
              combined.push(s);
              seen.add(key);
            }
          }

          // If still sparse, also try Overpass
          if (combined.length < 5) {
            const remote = await searchStationsOverpass(text, selectedStop.lat, selectedStop.lon);
            for (const s of remote) {
              const key = `${s.name}:${s.lat.toFixed(3)}`;
              if (!seen.has(key)) {
                combined.push(s);
                seen.add(key);
              }
            }
          }

          setStationResults(combined.slice(0, 15));
        }, 300);
      }
    },
    [selectedStop],
  );

  // Fetch departures when a stop is selected, enriching route list
  // with a reverse-way Overpass lookup to catch routes whose OSM
  // relations don't explicitly list this stop as a member.
  const [enrichedRoutes, setEnrichedRoutes] = useState<
    Array<{ ref?: string; name?: string; color?: string; mode: string }>
  >([]);

  useEffect(() => {
    if (!selectedStop) return;
    let cancelled = false;
    setLoading(true);
    setEnrichedRoutes(selectedStop.routes);

    // Fire enrichment + departure fetch in parallel
    const enrichPromise = fetchRoutesAtStop(selectedStop.lat, selectedStop.lon);

    enrichPromise
      .then((overpassRoutes) => {
        if (cancelled) return;
        // Merge Overpass-discovered routes into the known set
        const merged = [...selectedStop.routes];
        for (const r of overpassRoutes) {
          const label = routeBadgeLabel({ ref: r.ref, name: r.name });
          if (!merged.some((m) => routeBadgeLabel(m) === label)) {
            merged.push({ ref: r.ref, name: r.name, color: r.colour, mode: r.mode });
          }
        }
        if (!cancelled) setEnrichedRoutes(merged);

        // Generate departures from the full route list
        const routeNames = merged.map((r) => routeBadgeLabel(r));
        const routeColors = merged.map((r) => r.color);
        const modes = merged.map((r) => r.mode);
        return fetchDepartures(
          selectedStop.name,
          selectedStop.lat,
          selectedStop.lon,
          routeNames,
          routeColors,
          modes,
        );
      })
      .then((info) => {
        if (!cancelled && info) setDepartureInfo(info);
      })
      .catch(() => {
        if (!cancelled) setDepartureInfo(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      if (overpassTimerRef.current) clearTimeout(overpassTimerRef.current);
    };
  }, [selectedStop]);

  const handleClose = useCallback(() => {
    setSelectedStop(null);
  }, [setSelectedStop]);

  if (!selectedStop) return null;

  const bg = colors.surface;
  const uniqueRoutes = dedupeRoutes(enrichedRoutes);
  const cardHeight = showDirections ? CARD_H_DIRECTIONS : CARD_H;
  // When viewing itinerary detail, shrink to content so the map stays visible
  const heightStyle =
    showDirections && selectedItinerary ? { maxHeight: CARD_H_DIRECTIONS } : { height: cardHeight };

  return (
    <Animated.View
      style={[
        styles.card,
        {
          backgroundColor: bg,
          ...heightStyle,
          transform: [{ translateY }],
          paddingBottom: insets.bottom,
        },
        shadow.lg,
      ]}
    >
      {/* Handle bar */}
      <View style={styles.handleRow}>
        <View style={[styles.handle, { backgroundColor: colors.textSecondary }]} />
      </View>

      {/* Header: station name + close */}
      <View style={styles.header}>
        <Text style={[styles.stationName, { color: colors.text }]} numberOfLines={2}>
          {selectedStop.name}
        </Text>
        <TouchableOpacity
          onPress={handleClose}
          style={styles.closeBtn}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="close-circle" size={28} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {showDirections ? (
        /* ── Directions panel ───────────────────────────────────────────── */
        selectedItinerary ? (
          /* ── Route detail preview (Google Maps style) ────────────────── */
          <>
            <TouchableOpacity
              style={styles.backRow}
              onPress={() => setSelectedItinerary(null)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="arrow-back" size={18} color={colors.primary} />
              <Text style={[styles.backLabel, { color: colors.primary }]}>Routes</Text>
            </TouchableOpacity>
            <DirRouteDetail itinerary={selectedItinerary} />
          </>
        ) : (
          <>
            <TouchableOpacity
              style={styles.backRow}
              onPress={() => {
                setShowDirections(false);
                useTransitStore.getState().setDirectionsActive(false);
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="arrow-back" size={18} color={colors.primary} />
              <Text style={[styles.backLabel, { color: colors.primary }]}>Departures</Text>
            </TouchableOpacity>

            {/* Origin */}
            <View
              style={[
                dirStyles.field,
                {
                  backgroundColor: isDark ? 'rgba(50,50,70,0.5)' : 'rgba(0,0,0,0.04)',
                },
              ]}
            >
              <View style={[dirStyles.dot, { backgroundColor: colors.primary }]} />
              <Text style={[dirStyles.fieldText, { color: colors.text }]} numberOfLines={1}>
                {selectedStop.name}
              </Text>
            </View>

            {/* Destination input */}
            <View style={[dirStyles.field, dirStyles.destField, { borderColor: colors.border }]}>
              <View style={[dirStyles.dot, { backgroundColor: '#FF3B30' }]} />
              <TextInput
                ref={destInputRef}
                style={[dirStyles.destInput, { color: colors.text }]}
                placeholder="Search destination station"
                placeholderTextColor={colors.textSecondary}
                value={destQuery}
                onChangeText={handleDestQueryChange}
                returnKeyType="search"
              />
              {destQuery.length > 0 && (
                <TouchableOpacity
                  onPress={() => {
                    setDestQuery('');
                    setSelectedDest(null);
                    setDirItineraries(null);
                    setSelectedItinerary(null);
                    setDirError(null);
                    setStationResults([]);
                  }}
                >
                  <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
                </TouchableOpacity>
              )}
            </View>

            <ScrollView
              style={styles.departuresList}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {/* Loading */}
              {dirLoading && (
                <View style={styles.loadingRow}>
                  <ActivityIndicator size="small" color={colors.primary} />
                  <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
                    Planning route...
                  </Text>
                </View>
              )}

              {/* Error */}
              {dirError && !dirLoading && (
                <View style={styles.emptyRow}>
                  <Ionicons name="alert-circle-outline" size={20} color="#FF3B30" />
                  <Text style={[styles.emptyText, { color: '#FF3B30' }]}>{dirError}</Text>
                </View>
              )}

              {/* Itinerary results */}
              {!dirLoading &&
                !dirError &&
                dirItineraries?.map((it, i) => (
                  <DirItineraryRow
                    key={i}
                    itinerary={it}
                    onPress={() => setSelectedItinerary(it)}
                  />
                ))}

              {/* Station search results */}
              {!selectedDest && !dirLoading && (
                <>
                  {destQuery.length === 0 && (
                    <TouchableOpacity style={dirStyles.resultRow} onPress={handleLocationSelect}>
                      <Ionicons name="navigate" size={18} color={colors.primary} />
                      <Text
                        style={[dirStyles.resultText, { color: colors.primary, fontWeight: '600' }]}
                      >
                        Your location
                      </Text>
                    </TouchableOpacity>
                  )}
                  {stationResults.map((s, i) => (
                    <TouchableOpacity
                      key={`${s.name}-${i}`}
                      style={dirStyles.resultRow}
                      onPress={() => handleStationSelect(s)}
                    >
                      <Ionicons name="train" size={18} color={colors.textSecondary} />
                      <Text style={[dirStyles.resultText, { color: colors.text }]}>{s.name}</Text>
                    </TouchableOpacity>
                  ))}
                  {destQuery.length > 0 && stationResults.length === 0 && (
                    <View style={styles.emptyRow}>
                      <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                        No stations found
                      </Text>
                    </View>
                  )}
                </>
              )}
            </ScrollView>
          </>
        )
      ) : showDetails ? (
        /* ── Station details panel ─────────────────────────────────────── */
        <>
          <TouchableOpacity
            style={styles.backRow}
            onPress={() => setShowDetails(false)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="arrow-back" size={18} color={colors.primary} />
            <Text style={[styles.backLabel, { color: colors.primary }]}>Departures</Text>
          </TouchableOpacity>

          {detailsLoading && (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
                Loading details…
              </Text>
            </View>
          )}

          {!detailsLoading && (
            <ScrollView style={styles.departuresList} showsVerticalScrollIndicator={false}>
              {buildDetailRows(stationTags ?? {}).map((row, i) => (
                <TouchableOpacity
                  key={i}
                  style={[detailStyles.row, { borderBottomColor: colors.border }]}
                  onPress={() => (row.url ? Linking.openURL(row.url) : undefined)}
                  disabled={!row.url}
                  activeOpacity={row.url ? 0.7 : 1}
                >
                  <Ionicons
                    name={row.icon as any}
                    size={20}
                    color={colors.primary}
                    style={detailStyles.icon}
                  />
                  <View style={detailStyles.text}>
                    <Text style={[detailStyles.label, { color: colors.textSecondary }]}>
                      {row.label}
                    </Text>
                    <Text style={[detailStyles.value, { color: colors.text }]}>{row.value}</Text>
                  </View>
                  {row.url && (
                    <Ionicons name="open-outline" size={14} color={colors.textSecondary} />
                  )}
                </TouchableOpacity>
              ))}
              {stationTags !== null && buildDetailRows(stationTags).length === 0 && (
                <View style={styles.emptyRow}>
                  <Ionicons
                    name="information-circle-outline"
                    size={20}
                    color={colors.textSecondary}
                  />
                  <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                    No additional details found in OpenStreetMap
                  </Text>
                </View>
              )}
              <Text style={[detailStyles.source, { color: colors.textSecondary }]}>
                Data from OpenStreetMap contributors
              </Text>
            </ScrollView>
          )}
        </>
      ) : (
        /* ── Departure board ───────────────────────────────────────────── */
        <>
          {/* Action buttons */}
          <View style={styles.actions}>
            <ActionButton
              icon="navigate"
              label="Directions"
              color={colors.primary}
              textColor={colors.text}
              onPress={handleDirectionsPress}
            />
            <ActionButton
              icon="information-circle"
              label="Details"
              color={colors.surface}
              textColor={colors.text}
              border={colors.border}
              onPress={handleDetailsPress}
            />
          </View>

          {/* Route badges */}
          {uniqueRoutes.length > 0 && (
            <View style={styles.routeBadges}>
              {uniqueRoutes.map((r, i) => (
                <RouteBadge
                  key={`${r.name}-${i}`}
                  name={routeBadgeLabel(r)}
                  color={r.color}
                  mode={r.mode}
                />
              ))}
            </View>
          )}

          {/* Departures */}
          <ScrollView style={styles.departuresList} showsVerticalScrollIndicator={false}>
            {loading && (
              <View style={styles.loadingRow}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
                  Loading departures…
                </Text>
              </View>
            )}

            {!loading && departureInfo && departureInfo.departures.length === 0 && (
              <View style={styles.emptyRow}>
                <Ionicons name="train-outline" size={20} color={colors.textSecondary} />
                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                  No departure times available
                </Text>
              </View>
            )}

            {/* Alerts */}
            {departureInfo?.alerts.map((alert, i) => (
              <View key={i} style={[styles.alertRow, { backgroundColor: colors.surface }]}>
                <Ionicons name="information-circle" size={18} color="#2196F3" />
                <View style={styles.alertText}>
                  <Text style={[styles.alertHeader, { color: colors.text }]}>{alert.header}</Text>
                  {alert.description && (
                    <Text
                      style={[styles.alertDesc, { color: colors.textSecondary }]}
                      numberOfLines={2}
                    >
                      {alert.description}
                    </Text>
                  )}
                </View>
              </View>
            ))}

            {/* Departure rows */}
            {departureInfo?.departures.map((dep, i) => (
              <DepartureRow key={`${dep.routeName}-${dep.minutesAway}-${i}`} departure={dep} />
            ))}
          </ScrollView>
        </>
      )}
    </Animated.View>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────

function ActionButton({
  icon,
  label,
  color,
  textColor,
  border,
  onPress,
}: {
  icon: string;
  label: string;
  color: string;
  textColor: string;
  border?: string;
  onPress?: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        styles.actionBtn,
        { backgroundColor: color },
        border ? { borderWidth: 1, borderColor: border } : undefined,
      ]}
    >
      <Ionicons name={icon as any} size={18} color={textColor} />
      <Text style={[styles.actionLabel, { color: textColor }]}>{label}</Text>
    </TouchableOpacity>
  );
}

/**
 * Build display rows from raw OSM tags for the station details panel.
 */
function buildDetailRows(tags: Record<string, string>): Array<{
  icon: string;
  label: string;
  value: string;
  url?: string;
}> {
  const rows: Array<{ icon: string; label: string; value: string; url?: string }> = [];

  if (tags.operator || tags.network) {
    rows.push({
      icon: 'business-outline',
      label: 'Operator',
      value: tags.operator ?? tags.network,
    });
  }

  const addrParts = [
    [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' '),
    tags['addr:city'],
    tags['addr:state'],
    tags['addr:postcode'],
  ].filter(Boolean);
  if (addrParts.length) {
    rows.push({ icon: 'location-outline', label: 'Address', value: addrParts.join(', ') });
  }

  if (tags.platforms) {
    rows.push({ icon: 'trail-sign-outline', label: 'Platforms', value: tags.platforms });
  }

  if (tags.wheelchair) {
    const wc =
      tags.wheelchair === 'yes'
        ? 'Wheelchair accessible'
        : tags.wheelchair === 'limited'
          ? 'Limited wheelchair access'
          : tags.wheelchair === 'no'
            ? 'Not wheelchair accessible'
            : tags.wheelchair;
    rows.push({ icon: 'accessibility-outline', label: 'Accessibility', value: wc });
  }

  const website = tags.website ?? tags['contact:website'] ?? tags.url;
  if (website) {
    rows.push({ icon: 'globe-outline', label: 'Website', value: website, url: website });
  }

  if (tags.description || tags['description:en']) {
    rows.push({
      icon: 'information-circle-outline',
      label: 'Description',
      value: tags.description ?? tags['description:en'],
    });
  }

  if (tags.alt_name) {
    rows.push({ icon: 'swap-horizontal-outline', label: 'Also known as', value: tags.alt_name });
  }

  if (tags.note || tags['note:en']) {
    rows.push({ icon: 'chatbubble-outline', label: 'Note', value: tags.note ?? tags['note:en'] });
  }

  return rows;
}

// ── Directions itinerary row ────────────────────────────────────────

/**
 * Format walk time. Returns null when ≤1 minute (not worth showing).
 * ~80 m/min average walking speed.
 */
function formatWalkMins(meters: number): string | null {
  const mins = Math.round(meters / 80);
  if (mins <= 1) return null;
  return `${mins} min walk`;
}

function DirItineraryRow({
  itinerary,
  onPress,
}: {
  itinerary: OtpItinerary;
  onPress?: () => void;
}) {
  const { colors } = useTheme();
  const totalMins = Math.round(itinerary.duration / 60);
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  const durNum = h > 0 ? `${h}:${m.toString().padStart(2, '0')}` : String(totalMins);
  const durLabel = h > 0 ? 'hr' : 'min';
  const startTime = new Date(itinerary.start).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
  const endTime = new Date(itinerary.end).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
  const hasRealtime = itinerary.legs.some((l) => l.realTime);

  return (
    <TouchableOpacity
      style={[dirStyles.itRow, { borderBottomColor: colors.border }]}
      onPress={onPress}
      activeOpacity={0.65}
    >
      <View style={dirStyles.itDuration}>
        <Text style={[dirStyles.itDurNum, { color: colors.text }]}>{durNum}</Text>
        <Text style={[dirStyles.itDurLabel, { color: colors.textSecondary }]}>{durLabel}</Text>
      </View>
      <View style={dirStyles.itContent}>
        <Text style={[dirStyles.itTimeRange, { color: colors.text }]}>
          {startTime} {'\u2013'} {endTime}
        </Text>
        <View style={dirStyles.itLegs}>
          {itinerary.legs.map((leg, i) => (
            <React.Fragment key={i}>
              {i > 0 && <Ionicons name="chevron-forward" size={10} color={colors.textSecondary} />}
              <DirLegChip leg={leg} />
            </React.Fragment>
          ))}
        </View>
        <Text style={[dirStyles.itMeta, { color: colors.textSecondary }]}>
          {hasRealtime ? 'on time \u00b7 ' : ''}
          {itinerary.transfers > 0
            ? `${itinerary.transfers} transfer${itinerary.transfers > 1 ? 's' : ''} \u00b7 `
            : ''}
          {formatWalkMins(itinerary.walkDistance) ?? 'no walking'}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

function DirLegChip({ leg }: { leg: OtpLeg }) {
  if (leg.mode === 'WALK') {
    return (
      <View style={dirStyles.legChip}>
        <Ionicons name="walk" size={14} color="#888" />
        <Text style={[dirStyles.legChipText, { color: '#888' }]}>
          {Math.round(leg.duration / 60)}
        </Text>
      </View>
    );
  }
  const bg =
    leg.route?.color && /^[0-9A-Fa-f]{6}$/.test(leg.route.color)
      ? `#${leg.route.color}`
      : modeDefaultColor(leg.mode);
  const textCol = isLightColor(bg) ? '#000' : '#FFF';
  return (
    <View style={[dirStyles.legChip, { backgroundColor: bg }]}>
      <Ionicons name={leg.mode === 'BUS' ? 'bus' : 'train'} size={14} color={textCol} />
      <Text style={[dirStyles.legChipText, { color: textCol }]}>
        {leg.route?.shortName ?? leg.headsign ?? leg.mode.toLowerCase()}
      </Text>
    </View>
  );
}

// ── Route detail preview (Google Maps style) ────────────────────────

function DirRouteDetail({ itinerary }: { itinerary: OtpItinerary }) {
  const { colors } = useTheme();
  const totalMins = Math.round(itinerary.duration / 60);
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  const durStr = h > 0 ? `${h} hr ${m} min` : `${totalMins} min`;
  const arriveTime = new Date(itinerary.end).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });

  // Collect route badges from transit legs
  const transitLegs = itinerary.legs.filter((l) => l.mode !== 'WALK');

  return (
    <ScrollView style={styles.routeDetailScroll} showsVerticalScrollIndicator={false}>
      {/* Header: duration + arrival */}
      <View style={rdStyles.header}>
        <View style={rdStyles.headerLeft}>
          <Ionicons name="train" size={22} color={colors.primary} />
          <Text style={[rdStyles.headerDur, { color: colors.text }]}>{durStr}</Text>
        </View>
        <Text style={[rdStyles.headerArrive, { color: colors.textSecondary }]}>
          Arrive {arriveTime}
        </Text>
      </View>

      {/* Route badges row */}
      {transitLegs.length > 0 && (
        <View style={rdStyles.badgeRow}>
          {transitLegs.map((leg, i) => {
            const bg =
              leg.route?.color && /^[0-9A-Fa-f]{6}$/.test(leg.route.color)
                ? `#${leg.route.color}`
                : modeDefaultColor(leg.mode);
            const tc = isLightColor(bg) ? '#000' : '#FFF';
            return (
              <View key={i} style={[rdStyles.badge, { backgroundColor: bg }]}>
                <Text style={[rdStyles.badgeText, { color: tc }]}>
                  {leg.route?.shortName ?? leg.route?.longName ?? leg.mode}
                </Text>
              </View>
            );
          })}
        </View>
      )}

      {/* Timeline */}
      {itinerary.legs.map((leg, idx) => (
        <DirLegDetail key={idx} leg={leg} isLast={idx === itinerary.legs.length - 1} />
      ))}

      {/* Footer */}
      {(formatWalkMins(itinerary.walkDistance) !== null || itinerary.transfers > 0) && (
        <View style={rdStyles.footer}>
          <Text style={[rdStyles.footerText, { color: colors.textSecondary }]}>
            {formatWalkMins(itinerary.walkDistance) !== null
              ? `${formatWalkMins(itinerary.walkDistance)} total`
              : null}
            {itinerary.transfers > 0
              ? ` \u00b7 ${itinerary.transfers} transfer${itinerary.transfers > 1 ? 's' : ''}`
              : ''}
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

function DirLegDetail({ leg, isLast }: { leg: OtpLeg; isLast: boolean }) {
  const { colors } = useTheme();
  const [stopsExpanded, setStopsExpanded] = useState(false);
  const isWalk = leg.mode === 'WALK';
  const legColor = isWalk
    ? colors.textSecondary
    : leg.route?.color && /^[0-9A-Fa-f]{6}$/.test(leg.route.color)
      ? `#${leg.route.color}`
      : modeDefaultColor(leg.mode);

  const fromTime = new Date(leg.startTime).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
  const toTime = new Date(leg.endTime).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
  const durationMins = Math.round(leg.duration / 60);

  if (isWalk) {
    return (
      <View style={rdStyles.walkLeg}>
        <View style={rdStyles.timelineCol}>
          <View style={[rdStyles.timelineDot, { backgroundColor: colors.textSecondary }]} />
          <View
            style={[rdStyles.timelineLine, { backgroundColor: colors.textSecondary, opacity: 0.3 }]}
          />
        </View>
        <View style={rdStyles.walkContent}>
          <Ionicons name="walk" size={18} color={colors.textSecondary} />
          <Text style={[rdStyles.walkText, { color: colors.textSecondary }]}>
            Walk {durationMins} min
          </Text>
        </View>
      </View>
    );
  }

  // Transit leg
  const stops = leg.intermediateStops ?? [];
  const stopCount = stops.length;
  const legLabel = leg.route?.shortName ?? leg.route?.longName ?? leg.mode;
  const bgColor = legColor.startsWith('#') ? legColor : `#${legColor}`;
  const textCol = isLightColor(bgColor) ? '#000' : '#FFF';

  return (
    <View style={rdStyles.transitLeg}>
      {/* Origin station */}
      <View style={rdStyles.stationRow}>
        <View style={rdStyles.timelineCol}>
          <View style={[rdStyles.stationDot, { borderColor: bgColor }]} />
          <View style={[rdStyles.timelineLine, { backgroundColor: bgColor }]} />
        </View>
        <View style={rdStyles.stationContent}>
          <View style={rdStyles.stationNameRow}>
            <Text style={[rdStyles.stationName, { color: colors.text }]}>{leg.from.name}</Text>
            <Text style={[rdStyles.stationTime, { color: colors.textSecondary }]}>{fromTime}</Text>
          </View>
        </View>
      </View>

      {/* Route info + intermediate stops */}
      <View style={rdStyles.routeInfoRow}>
        <View style={rdStyles.timelineCol}>
          <View style={[rdStyles.timelineLine, { backgroundColor: bgColor, flex: 1 }]} />
        </View>
        <View style={rdStyles.routeInfoContent}>
          <View style={rdStyles.routeLabelRow}>
            <View style={[rdStyles.badge, { backgroundColor: bgColor }]}>
              <Ionicons name={leg.mode === 'BUS' ? 'bus' : 'train'} size={12} color={textCol} />
              <Text style={[rdStyles.badgeText, { color: textCol }]}>{legLabel}</Text>
            </View>
            {leg.headsign ? (
              <Text style={[rdStyles.headsign, { color: colors.textSecondary }]} numberOfLines={1}>
                {leg.headsign}
              </Text>
            ) : null}
          </View>
          {stopCount > 0 && (
            <TouchableOpacity
              onPress={() => setStopsExpanded((v) => !v)}
              activeOpacity={0.6}
              style={rdStyles.stopCountRow}
            >
              <Ionicons
                name={stopsExpanded ? 'chevron-up' : 'chevron-down'}
                size={14}
                color={colors.primary}
              />
              <Text style={[rdStyles.stopCount, { color: colors.primary }]}>
                {stopCount} stop{stopCount !== 1 ? 's' : ''} {'\u00b7'} {durationMins} min
              </Text>
            </TouchableOpacity>
          )}
          {stopCount > 0 && stopsExpanded && (
            <View style={rdStyles.intermediateStops}>
              {stops.map((s, si) => (
                <View key={si} style={rdStyles.intermediateStopRow}>
                  <View style={[rdStyles.intermediateStopDot, { borderColor: bgColor }]} />
                  <Text
                    style={[rdStyles.intermediateStopName, { color: colors.textSecondary }]}
                    numberOfLines={1}
                  >
                    {s.name}
                  </Text>
                </View>
              ))}
            </View>
          )}
          {stopCount === 0 && (
            <Text style={[rdStyles.stopCount, { color: colors.textSecondary }]}>
              {durationMins} min
            </Text>
          )}
        </View>
      </View>

      {/* Destination station (only on last leg) */}
      {isLast && (
        <View style={rdStyles.stationRow}>
          <View style={rdStyles.timelineCol}>
            <View style={[rdStyles.stationDot, { borderColor: bgColor }]} />
          </View>
          <View style={rdStyles.stationContent}>
            <View style={rdStyles.stationNameRow}>
              <Text style={[rdStyles.stationName, { color: colors.text }]}>{leg.to.name}</Text>
              <Text style={[rdStyles.stationTime, { color: colors.textSecondary }]}>{toTime}</Text>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

// ── Deduplication helpers ───────────────────────────────────────────

function dedupeRoutes(
  routes: Array<{ ref?: string; name?: string; color?: string; mode: string }>,
) {
  const seen = new Set<string>();
  return routes.filter((r) => {
    const key = `${routeBadgeLabel(r)}-${r.color}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Pick a compact display label for a route badge.
 * - Subway/tram: use ref ("A", "4", "L") or fallback to name
 * - Commuter rail with long ref: extract branch name from the full
 *   route name (e.g. "LIRR Hempstead Branch" → "Hempstead")
 */
function routeBadgeLabel(r: { ref?: string; name?: string }): string {
  const ref = r.ref ?? '';
  const name = r.name ?? '';

  // Short ref (subway): use it directly
  if (ref && ref.length <= 3) return ref;

  // Long ref (commuter rail): try to extract branch name from full name
  if (name) {
    // Strip direction prefix common in MBTA OSM data:
    // "Inbound: Foxboro => Forest Hills => South Station" → clean up
    const dirStripped = name
      .replace(/^(Inbound|Outbound|Northbound|Southbound|Eastbound|Westbound)\s*:\s*/i, '')
      .replace(/\s*=>\s*.*/i, '')
      .trim();
    // If we successfully stripped a direction pattern, use the remainder
    if (dirStripped && dirStripped !== name && dirStripped.length < name.length) {
      return dirStripped;
    }

    // "Long Island Rail Road: Hempstead Branch" → "Hempstead"
    // "LIRR Far Rockaway Branch" → "Far Rockaway"
    // "Metro-North Railroad New Haven Line" → "New Haven"
    // "Franklin/Foxboro Line" → "Franklin/Foxboro"
    const branchMatch = name.match(
      /(?::\s*|Rail(?:road)?\s+|LIRR\s+|Transit\s+)?([A-Z][\w\s/.-]+?)\s*(?:Branch|Line|Express|Local)\b/i,
    );
    if (branchMatch) return branchMatch[1].trim();

    // If name differs substantially from ref, show it
    if (ref && !name.toLowerCase().startsWith(ref.toLowerCase())) return name;
    // Strip the network prefix: "LIRR Babylon" → "Babylon"
    if (ref) {
      const stripped = name.replace(new RegExp(`^${ref}\\s*[-:]?\\s*`, 'i'), '').trim();
      if (stripped) return stripped;
    }
  }

  return ref || name || '?';
}

// ── Styles ──────────────────────────────────────────────────────────

const badgeStyles = StyleSheet.create({
  badge: {
    minWidth: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    marginRight: 8,
  },
  text: {
    fontSize: 14,
    fontWeight: '800',
  },
});

const depStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(128,128,128,0.2)',
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  routeBadge: {
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    marginRight: 10,
    flexShrink: 0,
  },
  routeBadgeText: {
    fontSize: 13,
    fontWeight: '800',
  },
  info: {
    flex: 1,
  },
  headsign: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 2,
  },
  timeLabel: {
    fontSize: 13,
  },
  right: {
    alignItems: 'flex-end',
    marginLeft: 12,
  },
  minutes: {
    fontSize: 22,
    fontWeight: '700',
  },
  minLabel: {
    fontSize: 12,
  },
});

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden',
  },
  handleRow: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 4,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    opacity: 0.4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  stationName: {
    fontSize: 22,
    fontWeight: '700',
    flex: 1,
    marginRight: 8,
  },
  closeBtn: {
    marginTop: 2,
  },
  actions: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 8,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    gap: 6,
  },
  actionLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  routeBadges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 4,
  },
  departuresList: {
    flex: 1,
  },
  routeDetailScroll: {
    flexShrink: 1,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    gap: 10,
  },
  loadingText: {
    fontSize: 14,
  },
  emptyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    gap: 10,
  },
  emptyText: {
    fontSize: 14,
  },
  alertRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 12,
    marginHorizontal: 12,
    marginBottom: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(33,150,243,0.08)',
    gap: 8,
  },
  alertText: {
    flex: 1,
  },
  alertHeader: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  alertDesc: {
    fontSize: 13,
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 10,
    gap: 6,
  },
  backLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
});

const detailStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  icon: {
    width: 24,
    textAlign: 'center',
  },
  text: {
    flex: 1,
  },
  label: {
    fontSize: 11,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  value: {
    fontSize: 14,
  },
  source: {
    fontSize: 11,
    textAlign: 'center',
    paddingVertical: 16,
    opacity: 0.6,
  },
});

const dirStyles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    marginBottom: 6,
    gap: 10,
  },
  destField: {
    borderWidth: 1,
    marginBottom: 4,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  fieldText: {
    fontSize: 15,
    fontWeight: '500',
    flex: 1,
  },
  destInput: {
    fontSize: 15,
    flex: 1,
    padding: 0,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(128,128,128,0.15)',
  },
  resultText: {
    fontSize: 15,
    flex: 1,
  },
  itRow: {
    flexDirection: 'row',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  itDuration: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 44,
  },
  itDurNum: {
    fontSize: 22,
    fontWeight: '700',
  },
  itDurLabel: {
    fontSize: 12,
  },
  itContent: {
    flex: 1,
    gap: 3,
  },
  itTimeRange: {
    fontSize: 14,
    fontWeight: '500',
  },
  itLegs: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
  },
  legChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    gap: 3,
  },
  legChipText: {
    fontSize: 12,
    fontWeight: '700',
  },
  itMeta: {
    fontSize: 12,
  },
});

const rdStyles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(128,128,128,0.2)',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerDur: {
    fontSize: 24,
    fontWeight: '700',
  },
  headerArrive: {
    fontSize: 14,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    gap: 4,
  },
  badgeText: {
    fontSize: 13,
    fontWeight: '800',
  },
  // Timeline elements
  transitLeg: {},
  walkLeg: {
    flexDirection: 'row',
    paddingHorizontal: 16,
  },
  timelineCol: {
    width: 28,
    alignItems: 'center',
  },
  timelineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 6,
  },
  timelineLine: {
    width: 3,
    flex: 1,
    minHeight: 20,
    borderRadius: 1.5,
  },
  stationDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 3,
    backgroundColor: 'transparent',
    marginTop: 3,
  },
  stationRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
  },
  stationContent: {
    flex: 1,
    paddingLeft: 8,
    paddingVertical: 2,
  },
  stationNameRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  stationName: {
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
    marginRight: 8,
  },
  stationTime: {
    fontSize: 13,
    fontWeight: '500',
  },
  routeInfoRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    minHeight: 48,
  },
  routeInfoContent: {
    flex: 1,
    paddingLeft: 8,
    paddingVertical: 6,
    gap: 4,
  },
  routeLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  headsign: {
    fontSize: 13,
  },
  stopCount: {
    fontSize: 13,
  },
  stopCountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  intermediateStops: {
    paddingLeft: 4,
    gap: 2,
  },
  intermediateStopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 3,
    gap: 8,
  },
  intermediateStopDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 2,
    backgroundColor: 'transparent',
  },
  intermediateStopName: {
    fontSize: 13,
    flex: 1,
  },
  walkContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 8,
    paddingVertical: 8,
  },
  walkText: {
    fontSize: 14,
  },
  footer: {
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  footerText: {
    fontSize: 13,
    textAlign: 'center',
  },
});
