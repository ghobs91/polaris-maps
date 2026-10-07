import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Modal } from '../common';
import { spacing, typography } from '../../constants/theme';
import { useTheme } from '../../contexts/ThemeContext';

export interface SortOption<T extends string> {
  key: T;
  label: string;
}

interface SortSheetProps<T extends string> {
  visible: boolean;
  title?: string;
  options: SortOption<T>[];
  value: T;
  onSelect: (key: T) => void;
  onClose: () => void;
}

/**
 * Modal radio list used to choose a sort order for saved places and lists.
 * Shows a checkmark on the active option and meets the 44pt touch target.
 */
export function SortSheet<T extends string>({
  visible,
  title = 'Sort by',
  options,
  value,
  onSelect,
  onClose,
}: SortSheetProps<T>) {
  const { colors } = useTheme();

  return (
    <Modal visible={visible} onClose={onClose} title={title}>
      {options.map((option) => {
        const selected = option.key === value;
        return (
          <Pressable
            key={option.key}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            onPress={() => {
              onSelect(option.key);
              onClose();
            }}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={option.label}
            testID={`sort-option-${option.key}`}
          >
            <Text style={[styles.label, { color: colors.text }]}>{option.label}</Text>
            {selected ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : null}
          </Pressable>
        );
      })}
    </Modal>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    gap: spacing.sm,
  },
  label: { ...typography.body, flex: 1 },
  pressed: { opacity: 0.6 },
});
