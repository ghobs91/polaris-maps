import React, { memo, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, typography } from '../../constants/theme';
import { useTheme } from '../../contexts/ThemeContext';
import { formatPlaceCategory } from '../../utils/placeCategory';
import { describeOpeningStatus } from '../../utils/openingStatus';
import { formatDistance } from '../../utils/units';
import { PlacePhotoStrip } from './PlacePhotoStrip';
import type { PlaceReviewSummary } from '../../services/places/placeReviewSummaryService';
import type { ExternalRatingProviderId } from '../../services/poi/externalRatings/types';
import type { SavedPlace } from '../../models/placeList';

interface SavedPlaceRowProps {
  place: SavedPlace;
  onPress: () => void;
  onLongPress?: () => void;
  onSaveToList?: () => void;
  /** Raw OSM opening hours resolved for this place, when known. */
  openingHours?: string | null;
  /** Resolved website; falls back to the saved place's own website. */
  websiteUrl?: string | null;
  /** Distance from the user in meters, when known. */
  distanceMeters?: number | null;
  /** Community or already-resolved external rating, when known. */
  reviewSummary?: PlaceReviewSummary | null;
}

const PROVIDER_LABEL: Record<ExternalRatingProviderId, string> = {
  tripadvisor: 'Tripadvisor',
  yelp: 'Yelp',
};

/**
 * Google-Maps-style place card: name, category, rating, open/closed + distance,
 * then a horizontally scrolling strip of the venue's website photos.
 */
export const SavedPlaceRow = memo(function SavedPlaceRow({
  place,
  onPress,
  onLongPress,
  onSaveToList,
  openingHours,
  websiteUrl,
  distanceMeters,
  reviewSummary,
}: SavedPlaceRowProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const category = formatPlaceCategory(place.category);
  const status = describeOpeningStatus(openingHours);
  const distance = distanceMeters != null ? formatDistance(distanceMeters) : null;
  const website = websiteUrl ?? place.website;

  const hasStatusLine = Boolean(status.text || distance);

  return (
    <Pressable
      style={({ pressed }) => [styles.container, pressed && styles.pressed]}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
    >
      <View style={styles.header}>
        <View style={styles.info}>
          <Text style={styles.name} numberOfLines={2}>
            {place.name}
          </Text>
          {category ? (
            <Text style={styles.category} numberOfLines={1}>
              {category}
            </Text>
          ) : null}
          {reviewSummary ? (
            <View style={styles.reviews}>
              <Ionicons name="star" size={13} color={colors.warning} />
              <Text style={[styles.reviewsRating, { color: colors.text }]}>
                {reviewSummary.rating.toFixed(1)}
              </Text>
              <Text style={[styles.reviewsCount, { color: colors.textSecondary }]}>
                ({reviewSummary.count.toLocaleString()})
              </Text>
              <Text style={[styles.reviewsSource, { color: colors.textSecondary }]}>
                {reviewSummary.source === 'community'
                  ? 'Community'
                  : reviewSummary.providers.map((provider) => PROVIDER_LABEL[provider]).join(' · ')}
              </Text>
            </View>
          ) : null}
          {hasStatusLine ? (
            <Text style={styles.statusLine} numberOfLines={1}>
              {status.text ? (
                <Text
                  style={{
                    color:
                      status.open === true
                        ? colors.success
                        : status.open === false
                          ? colors.error
                          : colors.textSecondary,
                  }}
                >
                  {status.text}
                </Text>
              ) : null}
              {status.text && distance ? <Text style={styles.dot}> · </Text> : null}
              {distance ? <Text style={styles.distance}>{distance}</Text> : null}
            </Text>
          ) : null}
          {place.note ? (
            <Text style={styles.note} numberOfLines={2}>
              {place.note}
            </Text>
          ) : null}
        </View>
        {onSaveToList ? (
          <Pressable
            onPress={onSaveToList}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Save ${place.name} to another list`}
            style={({ pressed }) => [styles.bookmark, pressed && styles.pressed]}
          >
            <Ionicons name="bookmark-outline" size={20} color={colors.textSecondary} />
          </Pressable>
        ) : null}
      </View>

      <PlacePhotoStrip websiteUrl={website} resetKey={place.id} />
    </Pressable>
  );
});

const createStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    container: {
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.lg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      gap: spacing.sm,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
    },
    info: { flex: 1, gap: 2 },
    name: { ...typography.h3, color: colors.text },
    category: { ...typography.bodySmall, color: colors.textSecondary },
    reviews: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
    reviewsRating: { ...typography.bodySmall, fontWeight: '600' },
    reviewsCount: { ...typography.bodySmall },
    reviewsSource: { ...typography.caption },
    statusLine: { ...typography.bodySmall },
    dot: { color: colors.textSecondary },
    distance: { color: colors.textSecondary },
    note: {
      ...typography.caption,
      color: colors.textSecondary,
      fontStyle: 'italic',
      marginTop: 2,
    },
    bookmark: { paddingTop: 2 },
    pressed: { opacity: 0.7 },
  });
