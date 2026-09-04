import React, { useCallback } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography, borderRadius } from '../../constants/theme';
import { GlassView } from '../common/GlassView';
import type { GeocodingResult } from '../../services/geocoding/geocodingService';

interface SearchResultsProps {
  results: GeocodingResult[];
  onSelect: (result: GeocodingResult) => void;
}

export function SearchResults({ results, onSelect }: SearchResultsProps) {
  const renderItem = useCallback(
    ({ item }: { item: GeocodingResult }) => (
      <Pressable
        style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
        onPress={() => onSelect(item)}
        accessibilityLabel={`${item.entry.text}, match ${Math.min(100, Math.max(0, Math.round(item.rank)))} percent`}
      >
        <View style={styles.iconContainer}>
          <Ionicons name="location-outline" size={20} color={colors.primary} />
        </View>
        <View style={styles.textContainer}>
          <Text style={styles.text} numberOfLines={1}>
            {item.entry.text}
          </Text>
          <Text style={styles.type} numberOfLines={1}>
            {item.entry.city ? item.entry.city : item.entry.type !== 'place' ? item.entry.type : ''}
            {typeof item.rank === 'number'
              ? ` · ${Math.min(100, Math.max(0, Math.round(item.rank)))}% match`
              : ''}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
      </Pressable>
    ),
    [onSelect],
  );

  if (results.length === 0) return null;

  return (
    <GlassView material="regular" style={styles.list}>
      <FlatList
        data={results}
        keyExtractor={(item) => String(item.entry.id)}
        style={styles.flatList}
        keyboardShouldPersistTaps="handled"
        renderItem={renderItem}
      />
    </GlassView>
  );
}

const styles = StyleSheet.create({
  list: {
    marginHorizontal: spacing.md,
    marginTop: spacing.xs,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    borderCurve: 'continuous',
    flex: 1,
  },
  flatList: {
    flex: 1,
  },
  item: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md - 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border + '40',
    flexDirection: 'row',
    alignItems: 'center',
  },
  itemPressed: {
    opacity: 0.7,
  },
  iconContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    overflow: 'hidden',
    borderCurve: 'continuous',
    backgroundColor: `${colors.primary}14`,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  textContainer: {
    flex: 1,
    marginRight: spacing.sm,
  },
  text: {
    ...typography.body,
    color: colors.text,
  },
  type: {
    ...typography.caption,
    color: colors.textSecondary,
    textTransform: 'capitalize',
    marginTop: 2,
  },
});
