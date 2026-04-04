import React, { useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTransitStore } from '../../stores/transitStore';
import { useMapStore } from '../../stores/mapStore';
import { useTheme } from '../../contexts/ThemeContext';
import { spacing, borderRadius } from '../../constants/theme';
import type { OtpItinerary, OtpLeg, TransitMode } from '../../models/transit';

// ── Mode icons ──────────────────────────────────────────────────────

const MODE_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  BUS: 'bus',
  RAIL: 'train',
  SUBWAY: 'subway',
  TRAM: 'train-outline',
  FERRY: 'boat',
  CABLE_CAR: 'git-network',
  GONDOLA: 'git-network',
  FUNICULAR: 'trending-up',
  WALK: 'walk',
  BICYCLE: 'bicycle',
};

const MODE_COLORS: Record<string, string> = {
  BUS: '#0F7E32',
  RAIL: '#E3470B',
  SUBWAY: '#1A5BA5',
  TRAM: '#D4A017',
  FERRY: '#00A5CF',
  WALK: '#888888',
  BICYCLE: '#4CAF50',
};

function modeIcon(mode: string): keyof typeof Ionicons.glyphMap {
  return MODE_ICONS[mode] ?? 'help-circle';
}

function modeColor(mode: string, routeColor?: string): string {
  if (routeColor && /^[0-9A-Fa-f]{6}$/.test(routeColor)) return `#${routeColor}`;
  return MODE_COLORS[mode] ?? '#007AFF';
}

// ── Formatting helpers ──────────────────────────────────────────────

function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatTime(isoOrTimestamp: string | number): string {
  const d =
    typeof isoOrTimestamp === 'number' ? new Date(isoOrTimestamp) : new Date(isoOrTimestamp);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

// ── Leg summary pill ────────────────────────────────────────────────

function LegPill({ leg }: { leg: OtpLeg }) {
  const color = modeColor(leg.mode, leg.route?.color ?? undefined);
  if (leg.mode === 'WALK') {
    return (
      <View style={[pillStyles.pill, { backgroundColor: '#E0E0E0' }]}>
        <Ionicons name="walk" size={14} color="#666" />
        <Text style={[pillStyles.pillText, { color: '#666' }]}>{formatDuration(leg.duration)}</Text>
      </View>
    );
  }

  return (
    <View style={[pillStyles.pill, { backgroundColor: color }]}>
      <Ionicons name={modeIcon(leg.mode)} size={14} color="#FFF" />
      <Text style={[pillStyles.pillText, { color: '#FFF' }]}>
        {leg.route?.shortName ?? leg.route?.longName ?? leg.mode}
      </Text>
    </View>
  );
}

const pillStyles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 3,
  },
  pillText: {
    fontSize: 12,
    fontWeight: '600',
  },
});

// ── Itinerary card ──────────────────────────────────────────────────

function ItineraryCard({
  itinerary,
  index,
  isSelected,
  onSelect,
  isDark,
}: {
  itinerary: OtpItinerary;
  index: number;
  isSelected: boolean;
  onSelect: (index: number) => void;
  isDark: boolean;
}) {
  const textColor = isDark ? '#E0E0E0' : '#333';
  const subtextColor = isDark ? '#A0A0B8' : '#888';
  const bgColor = isSelected
    ? isDark
      ? 'rgba(64,156,255,0.15)'
      : 'rgba(0,122,255,0.08)'
    : isDark
      ? 'rgba(50,50,70,0.5)'
      : 'rgba(245,245,250,0.9)';
  const borderColor = isSelected ? (isDark ? '#409CFF' : '#007AFF') : 'transparent';

  const hasRealtime = itinerary.legs.some((l) => l.realTime);

  return (
    <TouchableOpacity
      style={[cardStyles.card, { backgroundColor: bgColor, borderColor }]}
      onPress={() => onSelect(index)}
      activeOpacity={0.7}
    >
      {/* Header: time range + duration */}
      <View style={cardStyles.header}>
        <Text style={[cardStyles.timeRange, { color: textColor }]}>
          {formatTime(itinerary.start)} → {formatTime(itinerary.end)}
        </Text>
        <View style={cardStyles.durationBadge}>
          <Text style={cardStyles.durationText}>{formatDuration(itinerary.duration)}</Text>
        </View>
      </View>

      {/* Leg pills */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={cardStyles.pillScroll}>
        <View style={cardStyles.pillRow}>
          {itinerary.legs.map((leg, i) => (
            <React.Fragment key={i}>
              {i > 0 && <Ionicons name="chevron-forward" size={12} color={subtextColor} />}
              <LegPill leg={leg} />
            </React.Fragment>
          ))}
        </View>
      </ScrollView>

      {/* Footer: walk + transfers */}
      <View style={cardStyles.footer}>
        <Text style={[cardStyles.footerText, { color: subtextColor }]}>
          {formatDistance(itinerary.walkDistance)} walk
        </Text>
        {itinerary.transfers > 0 && (
          <Text style={[cardStyles.footerText, { color: subtextColor }]}>
            · {itinerary.transfers} transfer{itinerary.transfers > 1 ? 's' : ''}
          </Text>
        )}
        {hasRealtime && (
          <View style={cardStyles.realtimeBadge}>
            <View style={cardStyles.realtimeDot} />
            <Text style={cardStyles.realtimeText}>Live</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

const cardStyles = StyleSheet.create({
  card: {
    borderRadius: borderRadius.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 2,
    marginBottom: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  timeRange: {
    fontSize: 15,
    fontWeight: '600',
  },
  durationBadge: {
    backgroundColor: 'rgba(0,122,255,0.12)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  durationText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#007AFF',
  },
  pillScroll: {
    marginBottom: 6,
  },
  pillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  footerText: {
    fontSize: 12,
  },
  realtimeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 4,
    gap: 3,
  },
  realtimeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#34C759',
  },
  realtimeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#34C759',
  },
});

// ── Mode filter bar ─────────────────────────────────────────────────

function ModeFilterBar({ isDark }: { isDark: boolean }) {
  const enabledModes = useTransitStore((s) => s.enabledModes);
  const toggleMode = useTransitStore((s) => s.toggleMode);

  const modes: TransitMode[] = ['RAIL', 'SUBWAY', 'TRAM'];
  const textColor = isDark ? '#E0E0E0' : '#333';

  return (
    <View style={filterStyles.container}>
      {modes.map((mode) => {
        const active = enabledModes.includes(mode);
        const color = MODE_COLORS[mode] ?? '#007AFF';
        return (
          <TouchableOpacity
            key={mode}
            style={[
              filterStyles.chip,
              { backgroundColor: active ? color : isDark ? '#3A3A58' : '#E8E8F0' },
            ]}
            onPress={() => toggleMode(mode)}
            activeOpacity={0.7}
          >
            <Ionicons name={modeIcon(mode)} size={14} color={active ? '#FFF' : textColor} />
            <Text style={[filterStyles.chipText, { color: active ? '#FFF' : textColor }]}>
              {mode.charAt(0) + mode.slice(1).toLowerCase().replace('_', ' ')}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const filterStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 10,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    gap: 4,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '500',
  },
});

// ── Main exported component ─────────────────────────────────────────

interface TransitDirectionsPanelProps {
  onClose: () => void;
}

export function TransitDirectionsPanel({ onClose }: TransitDirectionsPanelProps) {
  const { isDark } = useTheme();
  const itineraries = useTransitStore((s) => s.itineraries);
  const selectedIndex = useTransitStore((s) => s.selectedItineraryIndex);
  const selectItinerary = useTransitStore((s) => s.selectItinerary);
  const isLoading = useTransitStore((s) => s.isLoadingItineraries);
  const error = useTransitStore((s) => s.tripPlanError);
  const destination = useTransitStore((s) => s.transitDestination);
  const setFitBounds = useMapStore((s) => s.setFitBounds);

  const textColor = isDark ? '#E0E0E0' : '#333';
  const subtextColor = isDark ? '#A0A0B8' : '#888';

  const handleSelect = useCallback(
    (index: number) => {
      selectItinerary(index);
      // Fit map to selected itinerary bounds
      const it = itineraries[index];
      if (!it) return;
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
    },
    [itineraries, selectItinerary, setFitBounds],
  );

  const styles = useMemo(
    () => createStyles(isDark, textColor, subtextColor),
    [isDark, textColor, subtextColor],
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name="bus" size={20} color="#1A5BA5" />
          <Text style={styles.title}>Transit to {destination?.name ?? 'destination'}</Text>
        </View>
        <TouchableOpacity onPress={onClose} hitSlop={12}>
          <Ionicons name="close-circle" size={24} color={subtextColor} />
        </TouchableOpacity>
      </View>

      <ModeFilterBar isDark={isDark} />

      {isLoading && (
        <View style={styles.center}>
          <ActivityIndicator size="small" color="#007AFF" />
          <Text style={styles.loadingText}>Finding routes...</Text>
        </View>
      )}

      {error && !isLoading && (
        <View style={styles.center}>
          <Ionicons name="alert-circle" size={24} color="#FF3B30" />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {!isLoading && !error && itineraries.length === 0 && (
        <View style={styles.center}>
          <Text style={[styles.emptyText, { color: subtextColor }]}>No transit routes found</Text>
        </View>
      )}

      {!isLoading && itineraries.length > 0 && (
        <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
          {itineraries.map((it, i) => (
            <ItineraryCard
              key={i}
              itinerary={it}
              index={i}
              isSelected={i === selectedIndex}
              onSelect={handleSelect}
              isDark={isDark}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const createStyles = (isDark: boolean, textColor: string, subtextColor: string) =>
  StyleSheet.create({
    container: {
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
      paddingBottom: spacing.md,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 10,
    },
    headerLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      flex: 1,
    },
    title: {
      fontSize: 16,
      fontWeight: '600',
      color: textColor,
      flex: 1,
    },
    center: {
      alignItems: 'center',
      paddingVertical: 20,
      gap: 8,
    },
    loadingText: {
      color: subtextColor,
      fontSize: 14,
    },
    errorText: {
      color: '#FF3B30',
      fontSize: 14,
      textAlign: 'center',
    },
    emptyText: {
      fontSize: 14,
    },
    list: {
      maxHeight: 300,
    },
  });
