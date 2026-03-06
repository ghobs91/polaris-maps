import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
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
  const pubkeyShort = review.authorPubkey.slice(0, 8) + '…' + review.authorPubkey.slice(-4);

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

      <Text style={styles.author}>{pubkeyShort}</Text>
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
});
