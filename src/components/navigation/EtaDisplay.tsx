import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Share } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatDistance } from '../../utils/units';
import { useNavigationStore } from '../../stores/navigationStore';
import { useTrafficStore } from '../../stores/trafficStore';
import { decodePolyline } from '../../utils/polyline';
import {
  averageRouteTrafficColor,
  ETA_COLOR_GREEN,
} from '../../services/traffic/routeTrafficService';

interface EtaDisplayProps {
  etaSeconds: number | null;
  remainingDistanceMeters: number | null;
  onExit?: () => void;
  onPreview?: () => void;
  isPreviewMode?: boolean;
  onAddDestination?: () => void;
  /** Destination name for share message */
  destinationName?: string;
}

export function EtaDisplay({
  etaSeconds,
  remainingDistanceMeters,
  onExit,
  onPreview,
  isPreviewMode,
  onAddDestination,
  destinationName,
}: EtaDisplayProps) {
  const trafficEtaSeconds = useNavigationStore((s) => s.trafficEtaSeconds);
  const freeFlowEtaSeconds = useNavigationStore((s) => s.freeFlowEtaSeconds);
  const activeRoute = useNavigationStore((s) => s.activeRoute);
  const normalizedSegments = useTrafficStore((s) => s.normalizedSegments);

  // Compute overall traffic color from segments along the route
  const etaColor = useMemo(() => {
    if (!activeRoute || normalizedSegments.length === 0) return ETA_COLOR_GREEN;
    const coords = decodePolyline(activeRoute.geometry);
    return averageRouteTrafficColor(coords, normalizedSegments);
  }, [activeRoute, normalizedSegments]);

  // trafficEtaSeconds from TomTom is always the full-route value. Scale it
  // by the remaining-distance fraction so it stays in sync with the chevron.
  let scaledTrafficEta: number | null = null;
  if (trafficEtaSeconds != null && activeRoute != null) {
    const totalMeters = activeRoute.summary.distanceMeters;
    const remaining = remainingDistanceMeters ?? totalMeters;
    const progress = totalMeters > 0 ? remaining / totalMeters : 0;
    scaledTrafficEta = Math.round(progress * trafficEtaSeconds);
  }

  // Use position-scaled traffic ETA when available, otherwise base route ETA
  const displayEta = scaledTrafficEta ?? etaSeconds;

  if (displayEta == null) return null;

  const arrival = new Date(Date.now() + displayEta * 1000);
  const arrivalStr = arrival.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const isTrafficAdjusted = scaledTrafficEta != null;
  const delaySecs =
    isTrafficAdjusted && freeFlowEtaSeconds != null
      ? Math.max(0, Math.round(displayEta - freeFlowEtaSeconds))
      : 0;

  return (
    <View
      style={styles.container}
      accessibilityRole="summary"
      accessibilityLabel={`ETA ${formatDuration(displayEta)}${remainingDistanceMeters != null ? `, ${formatDistance(remainingDistanceMeters)}` : ''}, arriving at ${arrivalStr}`}
    >
      <View style={styles.info}>
        <Text
          style={[styles.eta, { color: etaColor }]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {formatDuration(displayEta)}
        </Text>
        <Text
          style={styles.sub}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {remainingDistanceMeters != null ? `${formatDistance(remainingDistanceMeters)} · ` : ''}
          {arrivalStr}
          {isTrafficAdjusted ? ' · Live traffic' : ''}
          {delaySecs > 60 ? ` (+${Math.round(delaySecs / 60)} min delay)` : ''}
        </Text>
      </View>
      <View style={styles.buttons}>
        {onPreview && (
          <TouchableOpacity
            style={[styles.previewBtn, isPreviewMode && styles.previewBtnActive]}
            onPress={onPreview}
            activeOpacity={0.85}
          >
            <Ionicons
              name={isPreviewMode ? 'pause' : 'play'}
              size={18}
              color={isPreviewMode ? '#fff' : 'rgba(255,255,255,0.75)'}
            />
          </TouchableOpacity>
        )}
        {onAddDestination && (
          <TouchableOpacity
            style={styles.addDestBtn}
            onPress={onAddDestination}
            activeOpacity={0.85}
            accessibilityLabel="Add stop"
            accessibilityHint="Add an intermediate destination to your route"
            accessibilityRole="button"
          >
            <View style={styles.addDestIconContainer}>
              <Ionicons name="location-outline" size={18} color="#fff" />
              <View style={styles.addDestPlusBadge}>
                <Ionicons name="add" size={10} color="#fff" />
              </View>
            </View>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={styles.shareBtn}
          onPress={async () => {
            const dest = destinationName ?? 'destination';
            const arrival = new Date(Date.now() + (displayEta ?? 0) * 1000);
            const arrivalStr = arrival.toLocaleTimeString([], {
              hour: 'numeric',
              minute: '2-digit',
            });
            try {
              await Share.share({
                message: `I'm navigating to ${dest} — arriving around ${arrivalStr}`,
              });
            } catch {
              // User cancelled
            }
          }}
          activeOpacity={0.85}
          accessibilityLabel="Share trip"
          accessibilityHint="Share your destination and ETA"
          accessibilityRole="button"
        >
          <Ionicons name="share-outline" size={18} color="#fff" />
        </TouchableOpacity>
        {onExit && (
          <TouchableOpacity
            style={styles.exitBtn}
            onPress={onExit}
            activeOpacity={0.85}
            accessibilityLabel="Exit navigation"
            accessibilityHint="End turn-by-turn navigation"
            accessibilityRole="button"
          >
            <Text style={styles.exitText}>Exit</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function formatDuration(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.ceil((seconds % 3600) / 60);
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins} min`;
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(17,17,17,0.96)',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
    borderRadius: 28,
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 12,
  },
  info: {
    flex: 1,
  },
  eta: {
    fontSize: 32,
    fontWeight: '700',
    color: '#4ADE80',
    lineHeight: 36,
  },
  sub: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.55)',
    marginTop: 3,
  },
  buttons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  previewBtn: {
    width: 44,
    height: 44,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewBtnActive: {
    backgroundColor: 'rgba(74,222,128,0.25)',
  },
  shareBtn: {
    width: 44,
    height: 44,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  addDestBtn: {
    width: 44,
    height: 44,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  addDestIconContainer: {
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
    width: 22,
    height: 22,
  },
  addDestPlusBadge: {
    position: 'absolute',
    bottom: -2,
    right: -4,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#409CFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  exitBtn: {
    backgroundColor: '#EF4444',
    paddingHorizontal: 26,
    paddingVertical: 14,
    borderRadius: 999,
  },
  exitText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
});
