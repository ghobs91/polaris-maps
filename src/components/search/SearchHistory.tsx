import React from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography, borderRadius, shadow } from '../../constants/theme';
import type { GeocodingResult } from '../../services/geocoding/geocodingService';

interface SearchHistoryProps {
  history: GeocodingResult[];
  onSelect: (result: GeocodingResult) => void;
  onRemove: (entryId: number) => void;
  onClearAll: () => void;
}

export function SearchHistory({ history, onSelect, onRemove, onClearAll }: SearchHistoryProps) {
  if (history.length === 0) return null;

  return (
    <View style={styles.wrapper}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Recent</Text>
        <Pressable onPress={onClearAll} hitSlop={8}>
          <Text style={styles.clearAll}>Clear all</Text>
        </Pressable>
      </View>
      <FlatList
        data={history}
        keyExtractor={(item) => String(item.entry.id)}
        style={styles.list}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={false}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.item} onPress={() => onSelect(item)} activeOpacity={0.6}>
            <View style={styles.iconContainer}>
              <Ionicons name="time-outline" size={20} color={colors.textSecondary} />
            </View>
            <View style={styles.textContainer}>
              <Text style={styles.text} numberOfLines={1}>
                {item.entry.text}
              </Text>
              <Text style={styles.type}>{item.entry.type}</Text>
            </View>
            <Pressable onPress={() => onRemove(item.entry.id)} hitSlop={8}>
              <Ionicons name="close" size={18} color={colors.textSecondary} />
            </Pressable>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginHorizontal: spacing.md,
    marginTop: spacing.xs,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
    paddingHorizontal: 2,
  },
  headerTitle: {
    ...typography.caption,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontWeight: '600',
  },
  clearAll: {
    ...typography.caption,
    color: colors.primary,
  },
  list: {
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
    backgroundColor: colors.border,
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
