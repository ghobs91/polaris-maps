import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SegmentedControl, type SegmentedOption } from './SegmentedControl';
import { spacing, typography } from '../../constants/theme';
import { useTheme } from '../../contexts/ThemeContext';

interface SettingsChoiceRowProps<T> {
  title: string;
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Optional trailing detail, e.g. current usage. */
  detail?: string;
}

/**
 * A settings row whose choice control spans the full width beneath the label.
 *
 * Tucking a segmented control into a row's trailing slot squeezes the segments
 * (labels wrap or collapse entirely), so options get their own line instead.
 */
export function SettingsChoiceRow<T extends string | number | boolean>({
  title,
  options,
  value,
  onChange,
  detail,
}: SettingsChoiceRowProps<T>) {
  const { colors } = useTheme();

  return (
    <View style={styles.block}>
      <View style={styles.labelRow}>
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
          {title}
        </Text>
        {detail ? (
          <Text style={[styles.detail, { color: colors.textSecondary }]} numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
      <SegmentedControl options={options} value={value} onChange={onChange} label={title} />
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.xs,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  title: { ...typography.body, fontSize: 16, flexShrink: 1 },
  detail: { ...typography.caption, fontSize: 12 },
});
