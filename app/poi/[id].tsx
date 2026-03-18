import React, { useEffect, useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Linking,
  Pressable,
  Alert,
  FlatList,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { usePOIStore } from '../../src/stores/poiStore';
import { getPlaceById } from '../../src/services/poi/poiService';
import { getReviewsForPlace } from '../../src/services/poi/reviewService';
import { getPendingEdits } from '../../src/services/poi/editService';
import { attestPOI } from '../../src/services/poi/attestationService';
import { getImageryNearby } from '../../src/services/imagery/browseService';
import { ReviewCard } from '../../src/components/poi/ReviewCard';
import { RatingWidget } from '../../src/components/poi/RatingWidget';
import { Button, LoadingSpinner, ErrorBoundary } from '../../src/components/common';
import { colors, spacing, typography, borderRadius } from '../../src/constants/theme';
import type { StreetImagery } from '../../src/models/imagery';

export default function POIDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
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

  const handleAttest = useCallback(async () => {
    if (!selectedPlace) return;
    try {
      await attestPOI(selectedPlace.uuid, selectedPlace.lat, selectedPlace.lng);
      Alert.alert('Success', 'POI attestation submitted');
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    }
  }, [selectedPlace]);

  if (isLoadingPlace || !selectedPlace) {
    return (
      <View style={styles.center}>
        <LoadingSpinner size="large" />
      </View>
    );
  }

  const categoryLabel = selectedPlace.category.replace(/_/g, ' ');

  return (
    <ErrorBoundary>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.name}>{selectedPlace.name}</Text>
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
          <Pressable onPress={() => Linking.openURL(`tel:${selectedPlace.phone}`)}>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Phone</Text>
              <Text style={[styles.sectionBody, styles.link]}>{selectedPlace.phone}</Text>
            </View>
          </Pressable>
        )}

        {selectedPlace.website && (
          <Pressable onPress={() => Linking.openURL(selectedPlace.website!)}>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Website</Text>
              <Text style={[styles.sectionBody, styles.link]} numberOfLines={1}>
                {selectedPlace.website}
              </Text>
            </View>
          </Pressable>
        )}

        {selectedPlace.hours && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Hours</Text>
            <Text style={styles.sectionBody}>{selectedPlace.hours}</Text>
          </View>
        )}

        <View style={styles.actions}>
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
        </View>

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
            <FlatList
              data={nearbyImages.slice(0, 10)}
              horizontal
              showsHorizontalScrollIndicator={false}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.photoStrip}
              renderItem={({ item }) => (
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
              )}
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
  link: { color: colors.primary },
  actions: { marginTop: spacing.lg, gap: spacing.sm },
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
});
