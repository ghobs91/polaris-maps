import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  formatPackSize,
  packContentsLabel,
  packScopeDescription,
  packScopeLabel,
  packSizeBytes,
} from '../../services/regions/packSummary';
import { spacing, typography, borderRadius } from '../../constants/theme';
import { useTheme } from '../../contexts/ThemeContext';
import { useThemedStyles, type Theme } from '../../hooks/useThemedStyles';
import type { Region } from '../../models/region';

interface DownloadedRegionRowProps {
  region: Region;
  onDelete: (region: Region) => void;
}

/**
 * One line per region already on disk, with the action that frees the space.
 *
 * A full region card per downloaded pack cost ~230 pt of vertical space and
 * pushed the search field off screen; this is the same information on one line,
 * so the shelf stays a summary rather than a second catalogue.
 */
export function DownloadedRegionRow({ region, onDelete }: DownloadedRegionRowProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  const size = formatPackSize(packSizeBytes(region));
  const contents = packContentsLabel(region);
  // "Metro" vs "Regional" first: it is what tells two overlapping New York
  // packs apart in this shelf.
  const subtitle = [packScopeLabel(region), size, contents].filter(Boolean).join(' · ');

  return (
    <View style={styles.row}>
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {region.name}
        </Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {subtitle || 'Stored offline'}
        </Text>
      </View>
      <Pressable
        style={({ pressed }) => [styles.deleteBtn, pressed && styles.pressed]}
        onPress={() => onDelete(region)}
        accessibilityRole="button"
        accessibilityLabel={`Delete ${region.name}, ${packScopeDescription(region)}`}
        hitSlop={8}
      >
        <Ionicons name="trash-outline" size={15} color={colors.error} />
        <Text style={styles.deleteText}>Delete</Text>
      </Pressable>
    </View>
  );
}

const createStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.sm + 2,
      backgroundColor: colors.surface,
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: spacing.xs,
    },
    info: { flex: 1 },
    name: { ...typography.body, color: colors.text, fontWeight: '600' },
    subtitle: { ...typography.caption, color: colors.textSecondary, fontSize: 11 },
    deleteBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      borderWidth: 1,
      borderColor: colors.error,
      borderRadius: borderRadius.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
    },
    pressed: { opacity: 0.7 },
    deleteText: { ...typography.caption, color: colors.error, fontWeight: '600' },
  });
