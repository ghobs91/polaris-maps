import React, { memo, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, typography, borderRadius } from '../../constants/theme';
import { useTheme } from '../../contexts/ThemeContext';
import { suggestEmojiForList } from '../../utils/placeListEmoji';
import type { PlaceList } from '../../models/placeList';

interface PlaceListCardProps {
  list: PlaceList;
  onPress: () => void;
  onLongPress?: () => void;
  /** Edit mode: the icon becomes tappable and a delete control is revealed. */
  editing?: boolean;
  onIconPress?: () => void;
  onDelete?: () => void;
}

function listEmoji(list: PlaceList): string {
  return list.emoji?.trim() || suggestEmojiForList(list.name);
}

export const PlaceListCard = memo(function PlaceListCard({
  list,
  onPress,
  onLongPress,
  editing = false,
  onIconPress,
  onDelete,
}: PlaceListCardProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const emoji = listEmoji(list);

  const iconContent = <Text style={styles.emoji}>{emoji}</Text>;

  return (
    <Pressable
      style={({ pressed }) => [styles.container, pressed && styles.pressed]}
      onPress={onPress}
      onLongPress={onLongPress}
    >
      {editing && onIconPress ? (
        <Pressable
          onPress={onIconPress}
          accessibilityRole="button"
          accessibilityLabel={`Change icon for ${list.name}`}
          style={({ pressed }) => [
            styles.iconContainer,
            styles.iconEditable,
            pressed && styles.pressed,
          ]}
        >
          {iconContent}
          <View style={styles.iconBadge}>
            <Ionicons name="pencil" size={11} color="#FFFFFF" />
          </View>
        </Pressable>
      ) : (
        <View style={styles.iconContainer}>{iconContent}</View>
      )}
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {list.name}
        </Text>
        <Text style={styles.meta}>
          {list.isPrivate ? 'Private' : 'Shared'} · {list.places.length}{' '}
          {list.places.length === 1 ? 'place' : 'places'}
        </Text>
      </View>
      {editing && onDelete ? (
        <Pressable
          onPress={onDelete}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={`Delete ${list.name}`}
          style={({ pressed }) => [styles.deleteButton, pressed && styles.pressed]}
        >
          <Ionicons name="remove-circle" size={24} color={colors.error} />
        </Pressable>
      ) : null}
    </Pressable>
  );
});

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
      width: 52,
      height: 52,
      borderRadius: borderRadius.lg,
      backgroundColor: colors.surface,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: spacing.md,
    },
    iconEditable: {
      borderWidth: 1,
      borderColor: colors.border,
    },
    iconBadge: {
      position: 'absolute',
      right: -4,
      bottom: -4,
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: colors.background,
    },
    emoji: { fontSize: 26 },
    info: { flex: 1 },
    name: { ...typography.subtitle, color: colors.text },
    meta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
    deleteButton: { paddingLeft: spacing.sm },
    pressed: { opacity: 0.7 },
  });
