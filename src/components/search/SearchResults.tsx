import React from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography, borderRadius, shadow } from '../../constants/theme';
import type { GeocodingResult } from '../../services/geocoding/geocodingService';

interface SearchResultsProps {
  results: GeocodingResult[];
  onSelect: (result: GeocodingResult) => void;
}

export function SearchResults({ results, onSelect }: SearchResultsProps) {
  if (results.length === 0) return null;

  return (
    <FlatList
      data={results}
      keyExtractor={(item) => String(item.entry.id)}
      style={styles.list}
      keyboardShouldPersistTaps="handled"
      renderItem={({ item }) => (
        <TouchableOpacity style={styles.item} onPress={() => onSelect(item)} activeOpacity={0.6}>
          <View style={styles.iconContainer}>
            <Ionicons name="location-outline" size={20} color={colors.primary} />
          </View>
          <View style={styles.textContainer}>
            <Text style={styles.text} numberOfLines={1}>
              {item.entry.text}
            </Text>
            <Text style={styles.type} numberOfLines={1}>
              {item.entry.city
                ? item.entry.city
                : item.entry.type !== 'place'
                  ? item.entry.type
                  : ''}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
        </TouchableOpacity>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    marginHorizontal: spacing.md,
    marginTop: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    ...shadow.sm,
  },
  item: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md - 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
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
