import React, { useCallback } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { useTheme } from '../../contexts/ThemeContext';
import { useSettingsStore } from '../../stores/settingsStore';
import { spacing, typography, borderRadius } from '../../constants/theme';
import { visibleCategories } from './categoryCatalog';

/**
 * The settings root: categories, one row each.
 *
 * Deliberately the shape of iOS Settings — tinted icon tile, title, chevron — so
 * the first screen is a menu rather than the top of a long form. Selecting a
 * category pushes `/settings/<id>`, which renders only that category's groups.
 *
 * `onSelect` exists for the in-map panel, which closes itself and then navigates
 * instead of pushing a route behind its own sheet.
 */
export function SettingsCategories({
  onSelect,
  showHeading = true,
}: {
  onSelect?: (categoryId: string) => void;
  showHeading?: boolean;
}) {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const devMode = useSettingsStore((s) => s.devMode);
  const categories = visibleCategories(devMode);

  const styles = StyleSheet.create({
    content: { paddingBottom: spacing.xxl },
    heading: {
      ...typography.h1,
      color: colors.text,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.md,
    },
    group: {
      marginHorizontal: spacing.md,
      marginTop: spacing.md,
      backgroundColor: isDark ? '#1C1C1E' : '#FFFFFF',
      borderRadius: borderRadius.xl,
      overflow: 'hidden',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      paddingVertical: 11,
      minHeight: 52,
      gap: spacing.md,
    },
    iconTile: {
      width: 29,
      height: 29,
      borderRadius: 7,
      alignItems: 'center',
      justifyContent: 'center',
    },
    textBlock: { flex: 1 },
    title: { ...typography.h3, color: colors.text, fontSize: 17 },
    subtitle: { color: colors.textSecondary, fontSize: 12, marginTop: 1 },
    separator: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
      marginLeft: spacing.md + 29 + spacing.md,
    },
  });

  const open = useCallback(
    (id: string) => {
      if (onSelect) {
        onSelect(id);
        return;
      }
      router.push(`/settings/${id}`);
    },
    [onSelect, router],
  );

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
    >
      {showHeading ? <Text style={styles.heading}>Settings</Text> : null}
      <View style={styles.group}>
        {categories.map((category, index) => (
          <View key={category.id}>
            {index > 0 ? <View style={styles.separator} /> : null}
            <Pressable
              onPress={() => open(category.id)}
              accessibilityRole="button"
              accessibilityLabel={`${category.title}. ${category.subtitle}`}
              accessibilityHint="Opens these settings"
              style={({ pressed }) => [styles.row, { opacity: pressed ? 0.55 : 1 }]}
            >
              <View style={[styles.iconTile, { backgroundColor: category.tint }]}>
                <Ionicons name={category.icon} size={17} color="#FFFFFF" />
              </View>
              <View style={styles.textBlock}>
                <Text style={styles.title}>{category.title}</Text>
                <Text style={styles.subtitle} numberOfLines={1}>
                  {category.subtitle}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
            </Pressable>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
