import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { getReviewsForPlace, createOrUpdateReview } from '../../src/services/poi/reviewService';
import { ReviewCard } from '../../src/components/poi/ReviewCard';
import { RatingWidget } from '../../src/components/poi/RatingWidget';
import { Button, LoadingSpinner, ErrorBoundary } from '../../src/components/common';
import { colors, spacing, typography, borderRadius } from '../../src/constants/theme';
import type { Review } from '../../src/models/review';

export default function ReviewsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState('');

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
      await createOrUpdateReview(id, rating, body.trim() || undefined);
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
});
