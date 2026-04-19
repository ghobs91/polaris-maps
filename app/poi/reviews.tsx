import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getReviewsForPlace, createOrUpdateReview } from '../../src/services/poi/reviewService';
import { ReviewCard } from '../../src/components/poi/ReviewCard';
import { RatingWidget } from '../../src/components/poi/RatingWidget';
import { Button, LoadingSpinner, ErrorBoundary } from '../../src/components/common';
import { colors, spacing, typography, borderRadius } from '../../src/constants/theme';
import { useAtprotoAuthStore } from '../../src/stores/atprotoAuthStore';
import type { Review } from '../../src/models/review';
import type { PlaceReviewContext } from '../../src/models/review';

export default function ReviewsScreen() {
  const { id, osmId, name, lat, lng } = useLocalSearchParams<{
    id: string;
    osmId?: string;
    name?: string;
    lat?: string;
    lng?: string;
  }>();
  const router = useRouter();
  const session = useAtprotoAuthStore((s) => s.session);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState('');

  const placeContext = useMemo((): PlaceReviewContext | undefined => {
    if (!id) return undefined;
    return {
      poiUuid: id,
      source: osmId ? 'osm' : 'polaris',
      osmId: osmId ?? undefined,
      name: name ?? undefined,
      lat: lat ? parseFloat(lat) : undefined,
      lng: lng ? parseFloat(lng) : undefined,
    };
  }, [id, osmId, name, lat, lng]);

  const loadReviews = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const data = await getReviewsForPlace(id);
      setReviews(data);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadReviews();
  }, [loadReviews]);

  const handleSubmit = useCallback(async () => {
    if (!id) return;
    if (rating < 1) {
      Alert.alert('Rating Required', 'Please select a rating');
      return;
    }

    setSubmitting(true);
    try {
      await createOrUpdateReview(id, rating, body.trim() || undefined, placeContext);
      setRating(0);
      setBody('');
      await loadReviews();
      Alert.alert('Success', 'Your review has been submitted');
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }, [id, rating, body, loadReviews]);

  return (
    <ErrorBoundary>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={100}
      >
        <View style={styles.composeSection}>
          <Text style={styles.composeTitle}>Write a Review</Text>

          {session ? (
            <View style={styles.identityBanner}>
              <MaterialCommunityIcons name="butterfly" size={14} color="#0085FF" />
              <Text style={[styles.identityText, { color: '#0085FF' }]}>
                Posting as @{session.handle}
              </Text>
            </View>
          ) : (
            <View style={styles.identityBanner}>
              <MaterialCommunityIcons name="incognito" size={14} color={colors.textSecondary} />
              <Text style={[styles.identityText, { color: colors.textSecondary }]}>
                Posting anonymously
              </Text>
              <TouchableOpacity onPress={() => router.push('/settings')}>
                <Text style={styles.connectLink}>Connect Bluesky →</Text>
              </TouchableOpacity>
            </View>
          )}

          <RatingWidget value={rating} onChange={setRating} size={36} />
          <TextInput
            style={styles.bodyInput}
            value={body}
            onChangeText={setBody}
            placeholder="Share your experience (optional)"
            placeholderTextColor={colors.textSecondary}
            multiline
            numberOfLines={3}
          />
          <Button
            title={submitting ? 'Submitting…' : 'Submit Review'}
            onPress={handleSubmit}
            variant="primary"
            disabled={submitting || rating < 1}
          />
        </View>

        <View style={styles.divider} />

        {loading ? (
          <View style={styles.center}>
            <LoadingSpinner size="large" />
          </View>
        ) : (
          <FlatList
            data={reviews}
            keyExtractor={(item) => `${item.poiUuid}-${item.authorPubkey}`}
            renderItem={({ item }) => <ReviewCard review={item} />}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              <View style={styles.center}>
                <Text style={styles.emptyText}>No reviews yet. Be the first!</Text>
              </View>
            }
          />
        )}
      </KeyboardAvoidingView>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  composeSection: { padding: spacing.lg, gap: spacing.sm },
  composeTitle: { ...typography.subtitle, color: colors.text },
  bodyInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    ...typography.body,
    color: colors.text,
    backgroundColor: colors.surface,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  divider: { height: 1, backgroundColor: colors.border, marginHorizontal: spacing.lg },
  listContent: { padding: spacing.lg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  emptyText: { ...typography.body, color: colors.textSecondary },
  identityBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  identityText: {
    ...typography.caption,
  },
  connectLink: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '500',
    marginLeft: spacing.xs,
  },
});
