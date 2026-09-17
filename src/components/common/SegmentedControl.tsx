import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { spacing, typography } from '../../constants/theme';
import { useTheme } from '../../contexts/ThemeContext';

export interface SegmentedOption<T> {
  label: string;
  value: T;
}

interface SegmentedControlProps<T> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name for the group (e.g. "Appearance theme"). */
  label?: string;
}

/**
 * Accessible segmented control (radio group). Each segment exposes
 * `accessibilityRole="radio"` and its selected state, and every cell meets the
 * 44pt minimum touch target.
 */
export function SegmentedControl<T>({ options, value, onChange, label }: SegmentedControlProps<T>) {
  const { isDark } = useTheme();
  const activeColor = isDark ? '#0A84FF' : '#007AFF';
  const inactiveColor = isDark ? '#8E8E93' : '#6C6C70';
  const separatorColor = isDark ? 'rgba(84,84,88,0.34)' : 'rgba(60,60,67,0.18)';

  return (
    <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map((option, idx) => {
        const active = option.value === value;
        return (
          <React.Fragment key={option.label}>
            <Pressable
              style={styles.cell}
              onPress={() => onChange(option.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={option.label}
            >
              <Text
                style={[
                  styles.text,
                  { color: active ? activeColor : inactiveColor },
                  active ? styles.textActive : null,
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
            {idx < options.length - 1 ? (
              <View style={[styles.separator, { backgroundColor: separatorColor }]} />
            ) : null}
          </React.Fragment>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    minHeight: 44,
  },
  cell: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.sm,
  },
  separator: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
  },
  text: {
    ...typography.body,
    fontSize: 17,
    textAlign: 'center',
  },
  textActive: {
    fontWeight: '600',
  },
});
