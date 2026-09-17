import React, { useCallback } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { colors, spacing, borderRadius } from '../../constants/theme';
import { GlassView } from '../common/GlassView';
import { SearchResultRow } from './SearchResultRow';
import type { UnifiedSearchResult } from '../../services/search/unifiedSearch';

interface SearchResultsProps {
  results: UnifiedSearchResult[];
  onSelect: (result: UnifiedSearchResult) => void;
  /** Called when the list nears its end and more results are available. */
  onEndReached?: () => void;
  /** True while more results can be revealed. */
  hasMore?: boolean;
}

function canonicalKey(item: UnifiedSearchResult): string {
  return item.poi?.id != null
    ? `poi:${item.poi.id}`
    : `${item.name}:${item.lat.toFixed(5)}:${item.lng.toFixed(5)}`;
}

export function SearchResults({ results, onSelect, onEndReached, hasMore }: SearchResultsProps) {
  const renderItem = useCallback(
    ({ item }: { item: UnifiedSearchResult }) => (
      <SearchResultRow result={item} onPress={onSelect} />
    ),
    [onSelect],
  );

  if (results.length === 0) return null;

  return (
    <GlassView material="regular" style={styles.list}>
      <FlatList
        data={results}
        keyExtractor={canonicalKey}
        style={styles.flatList}
        keyboardShouldPersistTaps="handled"
        renderItem={renderItem}
        onEndReached={hasMore ? onEndReached : undefined}
        onEndReachedThreshold={0.4}
        ListFooterComponent={
          hasMore ? (
            <View style={styles.footer}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : results.length > 4 ? (
            <Text style={styles.endText}>End of results</Text>
          ) : null
        }
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
  footer: {
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  endText: {
    textAlign: 'center',
    color: colors.textSecondary,
    paddingVertical: spacing.md,
    fontSize: 12,
  },
});
