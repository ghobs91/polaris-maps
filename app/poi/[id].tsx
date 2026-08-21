import React, { useEffect, useCallback, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Linking,
  Pressable,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { usePOIStore } from '../../src/stores/poiStore';
import { useMapStore } from '../../src/stores/mapStore';
import { useOsmAuthStore } from '../../src/stores/osmAuthStore';
import { useSettingsStore } from '../../src/stores/settingsStore';
import { getPlaceById } from '../../src/services/poi/poiService';
import { getReviewsForPlace } from '../../src/services/poi/reviewService';
import { getPendingEdits } from '../../src/services/poi/editService';
import { attestPOI } from '../../src/services/poi/attestationService';
import { getImageryNearby } from '../../src/services/imagery/browseService';
import { ReviewCard } from '../../src/components/poi/ReviewCard';
import { RatingWidget } from '../../src/components/poi/RatingWidget';
import { Button, LoadingSpinner, ErrorBoundary, Modal } from '../../src/components/common';
import { SaveToListSheet } from '../../src/components/places';
import { colors, spacing, typography, borderRadius } from '../../src/constants/theme';
import { placeToOsmTags } from '../../src/utils/placeToOsmPoi';
import { checkPoiExistsInOsm } from '../../src/services/poi/osmFetcher';
import { submitOsmNodeCreate } from '../../src/services/osm/osmEditService';
import type { StreetImagery } from '../../src/models/imagery';
import {
  fetchChargingStations,
  type ChargingStation,
} from '../../src/services/poi/openChargeMapService';

const SAFE_URL_SCHEMES = ['https:', 'http:'];

function safeOpenURL(raw: string): void {
  try {
    const u = new URL(raw);
    if (SAFE_URL_SCHEMES.includes(u.protocol)) Linking.openURL(raw);
  } catch {
    /* malformed — ignore */
  }
}

function safePhone(raw: string): void {
  const cleaned = raw.replace(/[^0-9+#*]/g, '');
  if (cleaned.length > 0) Linking.openURL(`tel:${cleaned}`);
}

/** Session-scoped dedup set to prevent re-submitting the same POI within one session. */
const seededKeys = new Set<string>();

function dedupKey(lat: number, lng: number, name: string): string {
  const r = (n: number) => Math.round(n * 10_000) / 10_000;
  return `${r(lat)},${r(lng)},${name.trim().toLowerCase()}`;
}

export default function POIDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const setPendingDirectionsTarget = useMapStore((s) => s.setPendingDirectionsTarget);
  const accessToken = useOsmAuthStore((s) => s.accessToken);
  const contributionsEnabled = useSettingsStore((s) => s.permissions.poiContributionsEnabled);
  const autoSeedFired = useRef(false);
  const {
    selectedPlace,
    selectedPlaceReviews,
    pendingEdits,
    isLoadingPlace,
    setSelectedPlace,
    setSelectedPlaceReviews,
    setPendingEdits,
    setIsLoadingPlace,
  } = usePOIStore();
  const [nearbyImages, setNearbyImages] = useState<StreetImagery[]>([]);
  const [showSaveSheet, setShowSaveSheet] = useState(false);
  const [seedStatus, setSeedStatus] = useState<'idle' | 'submitting' | 'success'>('idle');
  const [chargingData, setChargingData] = useState<ChargingStation | null>(null);

  const loadPlace = useCallback(async () => {
    if (!id) return;
    setIsLoadingPlace(true);
    try {
      const [place, reviews, edits] = await Promise.all([
        getPlaceById(id),
        getReviewsForPlace(id),
        getPendingEdits(id),
      ]);
      setSelectedPlace(place);
      setSelectedPlaceReviews(reviews);
      setPendingEdits(edits);
      if (place) {
        const images = await getImageryNearby(place.lat, place.lng, 0.1);
        setNearbyImages(images);
      }
    } finally {
      setIsLoadingPlace(false);
    }
  }, [id, setSelectedPlace, setSelectedPlaceReviews, setPendingEdits, setIsLoadingPlace]);

  useEffect(() => {
    loadPlace();
    return () => setSelectedPlace(null);
  }, [loadPlace, setSelectedPlace]);

  // Fetch EV charging details from Open Charge Map when viewing a charging station
  useEffect(() => {
    if (!selectedPlace || selectedPlace.category !== 'ev_charging') {
      setChargingData(null);
      return;
    }
    let cancelled = false;
    fetchChargingStations(selectedPlace.lat, selectedPlace.lng, 0.1, 1)
      .then((stations) => {
        if (!cancelled) setChargingData(stations.length > 0 ? stations[0] : null);
      })
      .catch(() => {
        if (!cancelled) setChargingData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPlace]);

  // Selective auto-seed: when an Overture-sourced POI is opened, check if it
  // already exists in OSM.  If not, submit it automatically.
  useEffect(() => {
    if (
      !selectedPlace ||
      selectedPlace.source !== 'overture' ||
      !accessToken ||
      !contributionsEnabled
    ) {
      return;
    }

    // Prevent double-fire from React Strict Mode double-mount
    if (autoSeedFired.current) return;
    autoSeedFired.current = true;

    const key = dedupKey(selectedPlace.lat, selectedPlace.lng, selectedPlace.name);

    // Session-scoped dedup — already submitted this POI this session
    if (seededKeys.has(key)) return;

    const trySeed = async () => {
      setSeedStatus('submitting');

      try {
        const exists = await checkPoiExistsInOsm(
          selectedPlace.lat,
          selectedPlace.lng,
          selectedPlace.name,
        );
        if (exists) {
          setSeedStatus('idle');
          return;
        }
      } catch {
        // Overpass check failed — proceed with submission (fail-open).
        // Better to risk a rare duplicate than to block a legitimate submission.
      }

      const tags = placeToOsmTags(selectedPlace);

      try {
        await submitOsmNodeCreate(
          accessToken,
          selectedPlace.lat,
          selectedPlace.lng,
          tags,
          'Added Overture Maps POI via Polaris Maps',
        );
        seededKeys.add(key);
        setSeedStatus('success');
        setTimeout(() => setSeedStatus('idle'), 4000);
      } catch (e) {
        setSeedStatus('idle');
        Alert.alert(
          'Submission Failed',
          `Could not add this place to OpenStreetMap: ${(e as Error).message}`,
        );
      }
    };

    trySeed();
  }, [selectedPlace, accessToken, contributionsEnabled]);

  const handleAttest = useCallback(async () => {
    if (!selectedPlace) return;
    try {
      await attestPOI(selectedPlace.uuid, selectedPlace.lat, selectedPlace.lng);
      Alert.alert('Success', 'POI attestation submitted');
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    }
  }, [selectedPlace]);

  const handleDirectionsPress = useCallback(() => {
    if (!selectedPlace) return;
    setPendingDirectionsTarget({
      lat: selectedPlace.lat,
      lng: selectedPlace.lng,
      name: selectedPlace.name,
    });
    router.replace('/(tabs)');
  }, [selectedPlace, setPendingDirectionsTarget, router]);

  if (isLoadingPlace || !selectedPlace) {
    return (
      <View style={styles.center}>
        <LoadingSpinner size="large" />
      </View>
    );
  }

  const renderPhotoItem = useCallback(
    ({ item }: { item: StreetImagery }) => (
      <Pressable
        onPress={() =>
          router.push({
            pathname: '/imagery/viewer',
            params: {
              lat: String(selectedPlace.lat),
              lng: String(selectedPlace.lng),
              id: item.id,
            },
          })
        }
      >
        <View style={styles.photoThumb}>
          <Text style={styles.photoThumbIcon}>📷</Text>
          <Text style={styles.photoThumbBearing}>{item.bearing}°</Text>
        </View>
      </Pressable>
    ),
    [router, selectedPlace, styles],
  );

  const categoryLabel = selectedPlace.category.replace(/_/g, ' ');

  return (
    <ErrorBoundary>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.name}>{selectedPlace.name}</Text>
        {selectedPlace.brandName && selectedPlace.brandName !== selectedPlace.name && (
          <Text style={styles.brandName}>{selectedPlace.brandName}</Text>
        )}
        <Text style={styles.category}>{categoryLabel}</Text>

        <View style={styles.ratingRow}>
          <RatingWidget value={Math.round(selectedPlace.avgRating ?? 0)} readonly size={24} />
          <Text style={styles.ratingLabel}>
            {selectedPlace.avgRating?.toFixed(1) ?? '—'} ({selectedPlace.reviewCount})
          </Text>
        </View>

        <View style={styles.statusRow}>
          <View
            style={[
              styles.statusDot,
              selectedPlace.status === 'open' ? styles.open : styles.closed,
            ]}
          />
          <Text style={styles.statusText}>{selectedPlace.status}</Text>
        </View>

        {selectedPlace.addressStreet && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Address</Text>
            <Text style={styles.sectionBody}>
              {[
                selectedPlace.addressStreet,
                selectedPlace.addressCity,
                selectedPlace.addressState,
                selectedPlace.addressPostcode,
              ]
                .filter(Boolean)
                .join(', ')}
            </Text>
          </View>
        )}

        {selectedPlace.phone && (
          <Pressable onPress={() => safePhone(selectedPlace.phone!)}>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Phone</Text>
              <Text style={[styles.sectionBody, styles.link]}>{selectedPlace.phone}</Text>
            </View>
          </Pressable>
        )}

        {selectedPlace.emails && selectedPlace.emails.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Email</Text>
            {selectedPlace.emails.map((email) => (
              <Pressable key={email} onPress={() => safeOpenURL(`mailto:${email}`)}>
                <Text style={[styles.sectionBody, styles.link]}>{email}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {selectedPlace.website && (
          <Pressable onPress={() => safeOpenURL(selectedPlace.website!)}>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Website</Text>
              <Text style={[styles.sectionBody, styles.link]} numberOfLines={1}>
                {selectedPlace.website}
              </Text>
            </View>
          </Pressable>
        )}

        {selectedPlace.socials && selectedPlace.socials.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Social Media</Text>
            {selectedPlace.socials.map((url) => (
              <Pressable key={url} onPress={() => safeOpenURL(url)}>
                <Text style={[styles.sectionBody, styles.link]} numberOfLines={1}>
                  {url}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        {selectedPlace.hours && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Hours</Text>
            <Text style={styles.sectionBody}>{selectedPlace.hours}</Text>
          </View>
        )}

        {/* EV Charging speed from Open Charge Map */}
        {chargingData && chargingData.connections.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Charging Speed</Text>
            {chargingData.connections.map((conn, i) => {
              const speed = conn.powerKW ? `${conn.powerKW} kW` : 'Unknown speed';
              const fastBadge = conn.isFastCharge ? ' ⚡ Fast' : '';
              return (
                <View key={i} style={styles.chargeConnector}>
                  <Ionicons
                    name={conn.isFastCharge ? 'flash' : 'flash-outline'}
                    size={18}
                    color={conn.isFastCharge ? '#34C759' : colors.textSecondary}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sectionBody}>{conn.type}</Text>
                    <Text
                      style={[styles.sectionBody, { color: colors.textSecondary, fontSize: 13 }]}
                    >
                      {speed}
                      {fastBadge}
                    </Text>
                  </View>
                </View>
              );
            })}
            {chargingData.operator && (
              <Text
                style={[styles.sectionBody, { marginTop: spacing.xs, color: colors.textSecondary }]}
              >
                Operator: {chargingData.operator}
              </Text>
            )}
          </View>
        )}

        {seedStatus !== 'idle' && (
          <View style={[styles.seedBanner, seedStatus === 'success' && styles.seedBannerSuccess]}>
            {seedStatus === 'submitting' ? (
              <>
                <ActivityIndicator size="small" color="#7EBC6F" />
                <Text style={styles.seedBannerText}>Adding to OpenStreetMap...</Text>
              </>
            ) : (
              <>
                <Ionicons name="checkmark-circle" size={18} color="#fff" />
                <Text style={[styles.seedBannerText, styles.seedBannerTextSuccess]}>
                  Added to OpenStreetMap
                </Text>
              </>
            )}
          </View>
        )}

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.actions}
        >
          <Button title="Directions" onPress={handleDirectionsPress} variant="primary" />
          <Button
            title="Write Review"
            onPress={() =>
              router.push({ pathname: '/poi/reviews', params: { id: selectedPlace.uuid } })
            }
            variant="primary"
          />
          <Button
            title="Suggest Edit"
            onPress={() =>
              router.push({ pathname: '/poi/edit', params: { id: selectedPlace.uuid } })
            }
            variant="outline"
          />
          <Button title="Verify I'm Here" onPress={handleAttest} variant="outline" />
          <Button title="Save to List" onPress={() => setShowSaveSheet(true)} variant="outline" />

          {selectedPlace.source === 'overture' && (
            <Pressable
              style={({ pressed }) => [styles.osmAddButton, pressed && styles.osmAddButtonPressed]}
              onPress={() => {
                const tags = placeToOsmTags(selectedPlace);
                router.push({
                  pathname: '/poi/osm-edit',
                  params: {
                    name: selectedPlace.name,
                    lat: String(selectedPlace.lat),
                    lng: String(selectedPlace.lng),
                    initialTags: JSON.stringify(tags),
                  },
                });
              }}
            >
              <Ionicons name="add-circle-outline" size={20} color="#fff" />
              <Text style={styles.osmAddButtonText}>Add to OpenStreetMap</Text>
            </Pressable>
          )}
        </ScrollView>

        <Modal visible={showSaveSheet} onClose={() => setShowSaveSheet(false)} title="Save to List">
          <SaveToListSheet
            poiUuid={selectedPlace.uuid}
            placeName={selectedPlace.name}
            lat={selectedPlace.lat}
            lng={selectedPlace.lng}
            address={
              [selectedPlace.addressStreet, selectedPlace.addressCity, selectedPlace.addressState]
                .filter(Boolean)
                .join(', ') || undefined
            }
            category={selectedPlace.category}
            onDone={() => setShowSaveSheet(false)}
          />
        </Modal>

        {pendingEdits.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Pending Edits ({pendingEdits.length})</Text>
            {pendingEdits.map((edit) => (
              <View key={edit.id} style={styles.editCard}>
                <Text style={styles.editDiff}>
                  {edit.fieldName}: {String(edit.newValue ?? '')}
                </Text>
                <Text style={styles.editMeta}>
                  {edit.corroborations} corroboration{edit.corroborations !== 1 ? 's' : ''} ·{' '}
                  {edit.disputes} dispute{edit.disputes !== 1 ? 's' : ''}
                </Text>
              </View>
            ))}
          </View>
        )}

        {nearbyImages.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Photos</Text>
              <Pressable
                onPress={() =>
                  router.push({
                    pathname: '/imagery/viewer',
                    params: {
                      lat: String(selectedPlace.lat),
                      lng: String(selectedPlace.lng),
                    },
                  })
                }
              >
                <Text style={styles.link}>See all</Text>
              </Pressable>
            </View>
            <FlashList
              data={nearbyImages.slice(0, 10)}
              horizontal
              showsHorizontalScrollIndicator={false}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.photoStrip}
              renderItem={renderPhotoItem}
            />
          </View>
        )}

        {selectedPlaceReviews.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Reviews</Text>
              <Pressable
                onPress={() =>
                  router.push({ pathname: '/poi/reviews', params: { id: selectedPlace.uuid } })
                }
              >
                <Text style={styles.link}>See all</Text>
              </Pressable>
            </View>
            {selectedPlaceReviews.slice(0, 3).map((review) => (
              <ReviewCard key={`${review.poiUuid}-${review.authorPubkey}`} review={review} />
            ))}
          </View>
        )}
      </ScrollView>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  name: { ...typography.h1, color: colors.text, marginBottom: spacing.xs },
  brandName: {
    ...typography.body,
    color: colors.textSecondary,
    fontStyle: 'italic',
    marginBottom: spacing.xs,
  },
  category: {
    ...typography.body,
    color: colors.textSecondary,
    textTransform: 'capitalize',
    marginBottom: spacing.sm,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  ratingLabel: { ...typography.body, color: colors.textSecondary },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  statusDot: { width: 10, height: 10, borderRadius: 5, marginRight: spacing.xs },
  open: { backgroundColor: colors.success },
  closed: { backgroundColor: colors.error },
  statusText: { ...typography.body, textTransform: 'capitalize', color: colors.textSecondary },
  section: { marginTop: spacing.lg },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { ...typography.subtitle, color: colors.text, marginBottom: spacing.sm },
  sectionBody: { ...typography.body, color: colors.text },
  chargeConnector: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  link: { color: colors.primary },
  actions: { marginTop: spacing.lg, gap: spacing.sm, flexDirection: 'row', alignItems: 'center' },
  editCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  editDiff: {
    ...typography.caption,
    fontFamily: 'monospace',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  editMeta: { ...typography.caption, color: colors.textSecondary },
  photoStrip: { gap: spacing.sm, paddingVertical: spacing.xs },
  photoThumb: {
    width: 80,
    height: 80,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoThumbIcon: { fontSize: 24 },
  photoThumbBearing: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  osmAddButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: '#7EBC6F',
    paddingVertical: 14,
    borderRadius: borderRadius.lg,
    marginTop: spacing.sm,
  },
  osmAddButtonPressed: {
    opacity: 0.7,
  },
  osmAddButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  seedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#f0f8ed',
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: '#7EBC6F',
  },
  seedBannerSuccess: {
    backgroundColor: '#7EBC6F',
  },
  seedBannerText: {
    ...typography.bodySmall,
    color: '#2d6a4f',
    fontWeight: '600',
  },
  seedBannerTextSuccess: {
    color: '#fff',
  },
});
