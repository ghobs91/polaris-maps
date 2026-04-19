import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ActivityIndicator,
  FlatList,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useMapStore } from '../../stores/mapStore';
import { useNavigationStore } from '../../stores/navigationStore';
import { useTransitStore } from '../../stores/transitStore';
import * as FileSystem from 'expo-file-system';
import {
  computeRoute,
  initRouting,
  isRoutingInitialized,
} from '../../services/routing/routingService';
import { planTransitTrip } from '../../services/transit/transitRoutingService';
import { fetchRouteTrafficEta } from '../../services/traffic/tomtomRouteEta';
import {
  getRegionContainingPoint,
  getDownloadedRegions,
} from '../../services/regions/regionRepository';
import { extractTar } from '../../utils/archiveExtract';
import { getDatabase } from '../../services/database/init';
import { colors, spacing, typography, borderRadius, shadow } from '../../constants/theme';
import { formatDistance } from '../../utils/units';
import { TransportModeSelector, type TransportMode } from './TransportModeSelector';
import {
  shouldOfferParkAndRide,
  planParkAndRide,
  type ParkAndRideResult,
} from '../../services/routing/parkAndRideService';

export function LocationActionPanel() {
  const selectedLocation = useMapStore((s) => s.selectedLocation);
  const setSelectedLocation = useMapStore((s) => s.setSelectedLocation);
  const setFitBounds = useMapStore((s) => s.setFitBounds);
  const routePreview = useNavigationStore((s) => s.routePreview);
  const routePreviewTrafficEta = useNavigationStore((s) => s.routePreviewTrafficEta);
  const setRoutePreview = useNavigationStore((s) => s.setRoutePreview);
  const clearRoutePreview = useNavigationStore((s) => s.clearRoutePreview);
  const startNavigation = useNavigationStore((s) => s.startNavigation);
  const { bottom: safeBottom } = useSafeAreaInsets();
  const [isRouting, setIsRouting] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [usedOnlineRouting, setUsedOnlineRouting] = useState(false);
  const [transportMode, setTransportMode] = useState<TransportMode>('drive');
  const [showParkAndRide, setShowParkAndRide] = useState(false);
  const [parkAndRideResult, setParkAndRideResult] = useState<ParkAndRideResult | null>(null);
  const router = useRouter();

  const handleDismiss = useCallback(() => {
    setSelectedLocation(null);
    clearRoutePreview();
    setRouteError(null);
    setUsedOnlineRouting(false);
  }, [setSelectedLocation, clearRoutePreview]);

  /** Compute route and show it on the map (directions preview) */
  const handleDirections = useCallback(
    async (costingOverride?: 'auto' | 'pedestrian') => {
      const costing = costingOverride ?? 'auto';
      if (!selectedLocation) return;
      setIsRouting(true);
      setRouteError(null);
      setUsedOnlineRouting(false);
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

        // Try to load local routing tiles if a downloaded region exists
        const destRegion = await getRegionContainingPoint(
          selectedLocation.lat,
          selectedLocation.lng,
        );
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
                // Extraction failed — fall through to online routing
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
              await initRouting(graphTilePath);
            } catch {
              // initRouting failed — fall through to online routing
            }
          }
        }

        const routes = await computeRoute(
          [
            { lat: pos.coords.latitude, lng: pos.coords.longitude },
            { lat: selectedLocation.lat, lng: selectedLocation.lng },
          ],
          costing,
        );
        if (!routes.length) {
          setRouteError('No route found between these points');
          return;
        }
        if (!isRoutingInitialized()) setUsedOnlineRouting(true);

        // Store as preview (not active navigation)
        setRoutePreview(routes[0], routes.slice(1), selectedLocation, costing);

        // Zoom map to show the entire route
        if (routes[0].boundingBox) {
          setFitBounds(routes[0].boundingBox);
        }

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
    [selectedLocation, setRoutePreview, setFitBounds],
  );

  /** Start turn-by-turn navigation from the previewed route */
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
    setSelectedLocation(null);
    // Switch to the navigation tab
    router.push('/(tabs)/navigation');
  }, [routePreview, startNavigation, setSelectedLocation, router]);

  /** Handle transit directions */
  const handleTransitDirections = useCallback(async () => {
    if (!selectedLocation) return;
    setIsRouting(true);
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
        lat: selectedLocation.lat,
        lng: selectedLocation.lng,
        name: selectedLocation.name,
      };

      const enabledModes = useTransitStore.getState().enabledModes;
      const itineraries = await planTransitTrip({ from: origin, to: dest, modes: enabledModes });

      if (itineraries.length === 0) {
        setRouteError('No transit routes found');
        return;
      }
      useTransitStore.getState().setTransitOrigin(origin);
      useTransitStore.getState().setTransitDestination(dest);
      useTransitStore.getState().setItineraries(itineraries);
      useTransitStore.getState().setTransitLayerVisible(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setRouteError(msg || 'Transit routing failed');
    } finally {
      setIsRouting(false);
    }
  }, [selectedLocation]);

  /** Handle park-and-ride routing */
  const handleParkAndRide = useCallback(async () => {
    if (!selectedLocation) return;
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
        selectedLocation.lat,
        selectedLocation.lng,
      );
      setParkAndRideResult(result);
      setRoutePreview(result.drivingLeg, [], selectedLocation, 'auto');
      if (result.drivingLeg.boundingBox) setFitBounds(result.drivingLeg.boundingBox);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setRouteError(msg || 'Park & Ride routing failed');
    } finally {
      setIsRouting(false);
    }
  }, [selectedLocation, setRoutePreview, setFitBounds]);

  /** Handle transport mode change */
  const handleTransportModeChange = useCallback(
    (newMode: TransportMode) => {
      setTransportMode(newMode);
      clearRoutePreview();
      setRouteError(null);
      setParkAndRideResult(null);
      switch (newMode) {
        case 'drive':
          handleDirections('auto');
          break;
        case 'walk':
          handleDirections('pedestrian');
          break;
        case 'transit':
          handleTransitDirections();
          break;
        case 'park-and-ride':
          handleParkAndRide();
          break;
      }
    },
    [handleDirections, handleTransitDirections, handleParkAndRide, clearRoutePreview],
  );

  if (!selectedLocation && !routePreview) return null;

  const displayLocation =
    (selectedLocation ?? routePreview)
      ? (selectedLocation ?? useNavigationStore.getState().routePreviewDestination)
      : null;

  const panelContent = routePreview ? (
    // ── Phase 2: Route preview with directions ──
    <View style={styles.inner}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Ionicons
            name="map-outline"
            size={18}
            color={colors.primary}
            style={styles.locationIcon}
          />
          <Text style={styles.name} numberOfLines={1}>
            {displayLocation?.name ??
              `${displayLocation?.lat.toFixed(5)}, ${displayLocation?.lng.toFixed(5)}`}
          </Text>
        </View>
        <TouchableOpacity onPress={handleDismiss} style={styles.closeBtn} hitSlop={8}>
          <Ionicons name="close" size={20} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Route summary */}
      <View style={styles.routeSummary}>
        <View style={styles.summaryItem}>
          <Ionicons name="time-outline" size={14} color={colors.textSecondary} />
          <Text style={styles.summaryText}>
            {formatDuration(
              parkAndRideResult
                ? parkAndRideResult.totalDurationSeconds
                : (routePreviewTrafficEta ?? routePreview.summary.durationSeconds),
            )}
          </Text>
        </View>
        <View style={styles.summaryItem}>
          <Ionicons name="speedometer-outline" size={14} color={colors.textSecondary} />
          <Text style={styles.summaryText}>
            {formatDistance(routePreview.summary.distanceMeters)}
          </Text>
        </View>
      </View>

      {/* Transport mode selector */}
      <TransportModeSelector
        selected={transportMode}
        onSelect={handleTransportModeChange}
        showParkAndRide={showParkAndRide}
        isDark={false}
      />

      {/* Park-and-ride summary */}
      {parkAndRideResult && transportMode === 'park-and-ride' && (
        <View style={styles.parkAndRideSummary}>
          <View style={styles.parkAndRideLeg}>
            <Ionicons name="car" size={14} color={colors.primary} />
            <Text style={styles.parkAndRideText}>
              Drive to {parkAndRideResult.stationName} (
              {formatDuration(parkAndRideResult.drivingLeg.summary.durationSeconds)})
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={12} color={colors.textSecondary} />
          <View style={styles.parkAndRideLeg}>
            <Ionicons name="train" size={14} color={colors.primary} />
            <Text style={styles.parkAndRideText}>
              Transit ({formatDuration(parkAndRideResult.transitLeg.duration)})
            </Text>
          </View>
        </View>
      )}

      {usedOnlineRouting && (
        <TouchableOpacity
          style={styles.regionHint}
          onPress={() => router.push('/regions')}
          activeOpacity={0.7}
        >
          <Ionicons name="cloud-download-outline" size={14} color={colors.warning} />
          <Text style={styles.regionHintText}>
            Using online routing — download a region for offline navigation
          </Text>
        </TouchableOpacity>
      )}

      {/* Direction steps */}
      <FlatList
        data={routePreview.legs.flatMap((l) => l.maneuvers)}
        keyExtractor={(_, i) => String(i)}
        style={styles.stepsList}
        renderItem={({ item, index }) => (
          <View style={styles.stepRow}>
            <View style={styles.stepBadge}>
              <Text style={styles.stepBadgeText}>{index + 1}</Text>
            </View>
            <View style={styles.stepContent}>
              <Text style={styles.stepInstruction} numberOfLines={2}>
                {item.instruction}
              </Text>
              <Text style={styles.stepDistance}>{formatDistance(item.distanceMeters)}</Text>
            </View>
          </View>
        )}
      />

      {/* Navigate button */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.actionBtn, styles.primaryBtn]}
          onPress={handleStartNavigation}
          activeOpacity={0.8}
        >
          <Ionicons name="navigate" size={18} color={colors.white} />
          <Text style={styles.primaryBtnText}>Navigate</Text>
        </TouchableOpacity>
      </View>
    </View>
  ) : (
    // ── Phase 1: Initial location card ──
    <View style={styles.inner}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Ionicons name="location" size={18} color={colors.primary} style={styles.locationIcon} />
          <Text style={styles.name} numberOfLines={2}>
            {selectedLocation?.name ??
              `${selectedLocation?.lat.toFixed(5)}, ${selectedLocation?.lng.toFixed(5)}`}
          </Text>
        </View>
        <TouchableOpacity onPress={handleDismiss} style={styles.closeBtn} hitSlop={8}>
          <Ionicons name="close" size={20} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {selectedLocation?.name && (
        <Text style={styles.coords}>
          {selectedLocation.lat.toFixed(5)}, {selectedLocation.lng.toFixed(5)}
        </Text>
      )}

      {routeError && <Text style={styles.error}>{routeError}</Text>}

      {/* Transport mode selector */}
      <TransportModeSelector
        selected={transportMode}
        onSelect={handleTransportModeChange}
        showParkAndRide={showParkAndRide}
        isDark={false}
      />

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.actionBtn, styles.primaryBtn]}
          onPress={() => handleTransportModeChange(transportMode)}
          disabled={isRouting}
          activeOpacity={0.8}
        >
          {isRouting ? (
            <ActivityIndicator color={colors.white} size="small" />
          ) : (
            <Ionicons name="navigate" size={18} color={colors.white} />
          )}
          <Text style={styles.primaryBtnText}>{isRouting ? 'Routing…' : 'Directions'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={[styles.container, { bottom: safeBottom + 200 }]}>
      {Platform.OS === 'ios' ? (
        <BlurView intensity={70} tint="systemChromeMaterial" style={styles.blurCard}>
          {panelContent}
        </BlurView>
      ) : (
        <View style={[styles.blurCard, styles.androidCard]}>{panelContent}</View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: spacing.md,
    right: spacing.md,
  },
  blurCard: {
    borderRadius: borderRadius.xl,
    overflow: 'hidden',
    ...shadow.md,
  },
  androidCard: {
    backgroundColor: 'rgba(255,255,255,0.96)',
  },
  inner: {
    padding: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    flex: 1,
    gap: spacing.xs,
  },
  locationIcon: {
    marginTop: 2,
  },
  name: {
    ...typography.subtitle,
    color: colors.text,
    flex: 1,
  },
  closeBtn: {
    padding: 4,
  },
  coords: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    marginLeft: 26,
  },
  error: {
    ...typography.caption,
    color: colors.error,
    marginTop: spacing.xs,
  },
  regionHint: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    marginTop: spacing.xs,
    paddingVertical: spacing.xs,
  },
  regionHintText: {
    ...typography.caption,
    color: colors.warning,
    flex: 1,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.lg,
  },
  primaryBtn: {
    backgroundColor: colors.primary,
  },
  primaryBtnText: {
    ...typography.label,
    color: colors.white,
    fontWeight: '600',
  },
  secondaryBtn: {
    backgroundColor: 'rgba(0,122,255,0.1)',
  },
  secondaryBtnText: {
    ...typography.label,
    color: colors.primary,
    fontWeight: '600',
  },
  routeSummary: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
    marginLeft: 26,
  },
  summaryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  summaryText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  stepsList: {
    maxHeight: 200,
    marginTop: spacing.sm,
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
    backgroundColor: 'rgba(0,122,255,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 1,
  },
  stepBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.primary,
  },
  stepContent: {
    flex: 1,
  },
  stepInstruction: {
    ...typography.caption,
    color: colors.text,
  },
  stepDistance: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 11,
    marginTop: 1,
  },
  parkAndRideSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.md,
    backgroundColor: 'rgba(0,122,255,0.06)',
  },
  parkAndRideLeg: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  parkAndRideText: {
    ...typography.caption,
    color: colors.text,
    fontWeight: '500',
  },
});

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
