import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { spacing, typography, borderRadius } from '../../constants/theme';
import { useTheme } from '../../contexts/ThemeContext';

export interface SettingsSection {
  id: string;
  label: string;
}

interface SettingsSectionNavProps {
  sections: SettingsSection[];
  /** Id of the section currently at the top of the scroll view, if any. */
  activeId: string | null;
  onSelect: (id: string) => void;
}

/**
 * Horizontal "jump to" strip above the settings list.
 *
 * Settings grew past a screenful of groups, so reaching the last one meant a
 * long scroll with no landmarks. The chips stay pinned above the list and
 * scroll it directly to a group.
 */
export function SettingsSectionNav({ sections, activeId, onSelect }: SettingsSectionNavProps) {
  const { colors } = useTheme();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.content}
      style={styles.container}
      accessibilityRole="tablist"
      accessibilityLabel="Settings sections"
      keyboardShouldPersistTaps="handled"
    >
      {sections.map((section) => {
        const active = section.id === activeId;
        return (
          <Pressable
            key={section.id}
            onPress={() => onSelect(section.id)}
            hitSlop={6}
            accessibilityRole="tab"
            accessibilityLabel={`Jump to ${section.label} settings`}
            accessibilityState={{ selected: active }}
            style={({ pressed }) => [
              styles.chip,
              {
                backgroundColor: active ? colors.primary + '26' : colors.surface,
                borderColor: active ? colors.primary + '66' : colors.border,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Text
              style={[styles.chipText, { color: active ? colors.primary : colors.textSecondary }]}
              numberOfLines={1}
            >
              {section.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 0, flexShrink: 0 },
  content: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    gap: spacing.sm,
    alignItems: 'center',
  },
  chip: {
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.xs + 2,
    borderRadius: borderRadius.control,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipText: { ...typography.caption, fontSize: 13, fontWeight: '500' },
});
