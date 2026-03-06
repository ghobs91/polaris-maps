import React from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { colors, spacing, typography, borderRadius } from '../../constants/theme';
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
        <TouchableOpacity style={styles.item} onPress={() => onSelect(item)}>
          <Text style={styles.text} numberOfLines={1}>
            {item.entry.text}
          </Text>
          <Text style={styles.type}>{item.entry.type}</Text>
        </TouchableOpacity>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    maxHeight: 300,
    marginHorizontal: spacing.md,
    backgroundColor: colors.white,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  item: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  text: {
    ...typography.body,
    color: colors.text,
    flex: 1,
    marginRight: spacing.sm,
  },
  type: {
    ...typography.caption,
    color: colors.textSecondary,
    textTransform: 'capitalize',
  },
});
