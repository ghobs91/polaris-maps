import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { spacing, typography, borderRadius } from '../../constants/theme';
import { useTheme } from '../../contexts/ThemeContext';
import type { PlaceList } from '../../models/placeList';

interface PlaceListCardProps {
  list: PlaceList;
  onPress: () => void;
  onLongPress?: () => void;
}

const DEFAULT_EMOJIS: Record<string, string> = {
  favorites: '⭐',
  eats: '🍽️',
  drinks: '🍹',
  travel: '✈️',
  shopping: '🛍️',
};

function getEmoji(list: PlaceList): string {
  if (list.emoji) return list.emoji;
  const lower = list.name.toLowerCase();
  for (const [key, emoji] of Object.entries(DEFAULT_EMOJIS)) {
    if (lower.includes(key)) return emoji;
  }
  return '📍';
}

export function PlaceListCard({ list, onPress, onLongPress }: PlaceListCardProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const emoji = getEmoji(list);

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={onPress}
      onLongPress={onLongPress}
      activeOpacity={0.7}
    >
      <View style={styles.iconContainer}>
        <Text style={styles.emoji}>{emoji}</Text>
      </View>
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {list.name}
        </Text>
        <Text style={styles.meta}>
          {list.isPrivate ? 'Private' : 'Shared'} · {list.places.length}{' '}
          {list.places.length === 1 ? 'place' : 'places'}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const createStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.lg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    iconContainer: {
      width: 44,
      height: 44,
      borderRadius: borderRadius.md,
      backgroundColor: colors.surface,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: spacing.md,
    },
    emoji: { fontSize: 22 },
    info: { flex: 1 },
    name: { ...typography.subtitle, color: colors.text },
    meta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  });
