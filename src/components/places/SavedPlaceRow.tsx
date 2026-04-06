import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, typography, borderRadius } from '../../constants/theme';
import { useTheme } from '../../contexts/ThemeContext';
import type { SavedPlace } from '../../models/placeList';

interface SavedPlaceRowProps {
  place: SavedPlace;
  onPress: () => void;
  onLongPress?: () => void;
  onSaveToList?: () => void;
}

export function SavedPlaceRow({ place, onPress, onLongPress, onSaveToList }: SavedPlaceRowProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const subtitle = [place.address, place.category?.replace(/_/g, ' ')].filter(Boolean).join(' · ');

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={onPress}
      onLongPress={onLongPress}
      activeOpacity={0.7}
    >
      <View style={styles.marker}>
        <Text style={styles.markerIcon}>📌</Text>
      </View>
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {place.name}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
        {place.note ? (
          <Text style={styles.note} numberOfLines={2}>
            {place.note}
          </Text>
        ) : null}
      </View>
      {onSaveToList && (
        <TouchableOpacity onPress={onSaveToList} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="bookmark-outline" size={20} color={colors.textSecondary} />
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

const createStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing.sm + 2,
      paddingHorizontal: spacing.lg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    marker: {
      width: 36,
      height: 36,
      borderRadius: borderRadius.sm,
      backgroundColor: colors.surface,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: spacing.md,
    },
    markerIcon: { fontSize: 16 },
    info: { flex: 1 },
    name: { ...typography.body, color: colors.text },
    subtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 1 },
    note: {
      ...typography.caption,
      color: colors.textSecondary,
      fontStyle: 'italic',
      marginTop: 2,
    },
  });
