import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, spacing, typography, borderRadius } from '../../constants/theme';
import type { Review } from '../../models/review';

interface ReviewCardProps {
  review: Review;
}

export function ReviewCard({ review }: ReviewCardProps) {
  const date = new Date(review.createdAt * 1000);
  const dateStr = date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  const isAtproto = review.source === 'atproto';
  const authorLabel = isAtproto ? (review.authorHandle ?? review.authorPubkey) : 'Anonymous';
  const authorIcon = isAtproto ? 'butterfly' : 'incognito';
  const authorColor = isAtproto ? '#0085FF' : colors.textSecondary;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.stars}>
          {'★'.repeat(review.rating)}
          {'☆'.repeat(5 - review.rating)}
        </Text>
        <Text style={styles.date}>{dateStr}</Text>
      </View>

      {review.text && <Text style={styles.body}>{review.text}</Text>}

      <View style={styles.authorRow}>
        <MaterialCommunityIcons name={authorIcon} size={14} color={authorColor} />
        <Text style={[styles.author, { color: authorColor }]}>{authorLabel}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  stars: {
    fontSize: 16,
    color: colors.warning,
  },
  date: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  body: {
    ...typography.body,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  author: {
    ...typography.caption,
    color: colors.textSecondary,
    fontFamily: 'monospace',
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
});
