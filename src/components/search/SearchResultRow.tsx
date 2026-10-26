import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { getPoiCategory } from '../../utils/poiCategories';
import { formatDistance } from '../../utils/units';
import { borderRadius, spacing, typography } from '../../constants/theme';
import { useTheme } from '../../contexts/ThemeContext';
import { useThemedStyles, type Theme } from '../../hooks/useThemedStyles';
import { usePlaceThumbnail } from '../../hooks/usePlaceThumbnail';
import type { UnifiedSearchResult } from '../../services/search/unifiedSearch';

interface SearchResultRowProps {
  result: UnifiedSearchResult;
  onPress: (result: UnifiedSearchResult) => void;
}

function priceLabel(level: number): string {
  return '$'.repeat(Math.max(1, Math.min(4, Math.round(level))));
}

/**
 * Rich search result row: category icon or lazily loaded photo, name, subtitle,
 * and optional rating / open-now / price / distance with graceful omission.
 */
export const SearchResultRow = memo(function SearchResultRow({
  result,
  onPress,
}: SearchResultRowProps) {
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const thumbnailUrl = usePlaceThumbnail(result);
  const isStation = result.osmType === 'railway' || result.osmSubtype === 'station';
  const { icon, color } = getPoiCategory(result.osmType ?? '', result.osmSubtype ?? '');

  const subtitleParts: string[] = [];
  if (isStation) subtitleParts.push('Transit Station');
  if (result.brand && result.brand !== result.name) subtitleParts.push(result.brand);
  if (result.city) subtitleParts.push(result.city);
  const subtitle = subtitleParts.length > 0 ? subtitleParts.join(' · ') : result.subtitle;
  const hasDistance = result.distanceKm > 0;

  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={() => onPress(result)}
      accessibilityRole="button"
      accessibilityLabel={[
        result.name,
        subtitle,
        result.rating != null ? `${result.rating.toFixed(1)} stars` : null,
        result.openNow === false ? 'closed' : result.openNow === true ? 'open' : null,
        hasDistance ? `${formatDistance(result.distanceKm * 1000)} away` : null,
      ]
        .filter(Boolean)
        .join(', ')}
    >
      <View style={[styles.iconWrap, { backgroundColor: `${color}22` }]}>
        {thumbnailUrl ? (
          <Image
            source={{ uri: thumbnailUrl }}
            style={styles.thumbnail}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={180}
            recyclingKey={thumbnailUrl}
            accessibilityIgnoresInvertColors
            testID="search-result-thumbnail"
          />
        ) : (
          <Ionicons
            name={isStation ? 'train' : (icon as keyof typeof Ionicons.glyphMap)}
            size={20}
            color={color}
          />
        )}
      </View>

      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>
          {result.name}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
        <View style={styles.metaRow}>
          {result.rating != null ? (
            <View style={styles.metaItem}>
              <Ionicons name="star" size={12} color="#FFB300" />
              <Text style={styles.metaText}>{result.rating.toFixed(1)}</Text>
            </View>
          ) : null}
          {result.openNow === true ? (
            <Text style={[styles.metaText, styles.open]}>Open</Text>
          ) : result.openNow === false ? (
            <Text style={[styles.metaText, styles.closed]}>Closed</Text>
          ) : null}
          {result.priceLevel != null ? (
            <Text style={styles.metaText}>{priceLabel(result.priceLevel)}</Text>
          ) : null}
          {hasDistance ? (
            <Text style={styles.metaText}>{formatDistance(result.distanceKm * 1000)}</Text>
          ) : null}
        </View>
      </View>

      <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
    </Pressable>
  );
});

const createStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border + '30',
    },
    rowPressed: { opacity: 0.7 },
    iconWrap: {
      width: 44,
      height: 44,
      borderRadius: borderRadius.md,
      borderCurve: 'continuous',
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: spacing.sm + 2,
    },
    thumbnail: { width: 44, height: 44 },
    body: { flex: 1, marginRight: spacing.sm },
    name: { ...typography.body, color: colors.text, fontWeight: '500' },
    subtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 3 },
    metaItem: { flexDirection: 'row', alignItems: 'center', gap: 2 },
    metaText: { ...typography.caption, color: colors.textSecondary },
    open: { color: '#2E7D32', fontWeight: '600' },
    closed: { color: '#C62828', fontWeight: '600' },
  });
