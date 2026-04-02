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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
} from '../../services/transit/transitLineFetcher';

const { height: SCREEN_H } = Dimensions.get('window');
const CARD_H = Math.min(SCREEN_H * 0.55, 480);

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
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const selectedStop = useTransitStore((s) => s.selectedStop);
  const setSelectedStop = useTransitStore((s) => s.setSelectedStop);

  const [departureInfo, setDepartureInfo] = useState<StopDepartureInfo | null>(null);
  const [loading, setLoading] = useState(false);

  // Station details panel state
  const [showDetails, setShowDetails] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [stationTags, setStationTags] = useState<Record<string, string> | null>(null);

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
    };
  }, [selectedStop]);

  const handleClose = useCallback(() => {
    setSelectedStop(null);
  }, [setSelectedStop]);

  if (!selectedStop) return null;

  const bg = colors.surface;
  const uniqueRoutes = dedupeRoutes(enrichedRoutes);

  return (
    <Animated.View
      style={[
        styles.card,
        {
          backgroundColor: bg,
          height: CARD_H,
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

      {showDetails ? (
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
    // "Long Island Rail Road: Hempstead Branch" → "Hempstead"
    // "LIRR Far Rockaway Branch" → "Far Rockaway"
    // "Metro-North Railroad New Haven Line" → "New Haven"
    const branchMatch = name.match(
      /(?::\s*|Rail(?:road)?\s+|LIRR\s+|Transit\s+)([A-Z][\w\s-]+?)\s*(?:Branch|Line|Express|Local)\b/i,
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
