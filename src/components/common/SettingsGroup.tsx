import React, { type ReactNode } from 'react';
import { StyleSheet, Text, View, type ViewStyle, type TextStyle } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { spacing, typography, borderRadius, iosListGroup } from '../../constants/theme';

interface SettingsGroupProps {
  /** Optional uppercase section title (e.g. "ACCOUNTS"). */
  header?: string;
  /** Optional footer text shown below the section (e.g. a privacy disclaimer). */
  footer?: string;
  children: ReactNode;
  style?: ViewStyle;
}

/**
 * A grouped section in the iOS Settings list.
 *
 * - Solid surface background (no glass tint) so rows look "table-like" even when
 *   the rest of the app uses Liquid Glass.
 * - 10pt rounded corners with hairline internal separators between rows.
 * - Page background shows through the gap between sections.
 */
export function SettingsGroup({ header, footer, children, style }: SettingsGroupProps) {
  const { isDark } = useTheme();
  const styles = isDark ? darkStyles : lightStyles;
  const childArray = React.Children.toArray(children).filter(Boolean);

  return (
    <View style={styles.outer}>
      {header ? <Text style={styles.header}>{header}</Text> : null}
      <View style={[styles.section, style]}>
        {childArray.map((child, idx) => (
          <View key={idx}>
            {child}
            {idx < childArray.length - 1 ? <View style={styles.separator} /> : null}
          </View>
        ))}
      </View>
      {footer ? <Text style={styles.footer}>{footer}</Text> : null}
    </View>
  );
}

const baseSection: ViewStyle = {
  borderRadius: borderRadius.iosGrouped,
  borderCurve: 'continuous',
  overflow: 'hidden',
};

const baseHeader: TextStyle = {
  ...typography.caption,
  fontSize: 13,
  fontWeight: '400',
  letterSpacing: 0.4,
  textTransform: 'uppercase',
  marginBottom: spacing.sm,
  marginLeft: spacing.md,
};

const baseFooter: TextStyle = {
  ...typography.caption,
  fontSize: 12,
  marginTop: spacing.sm,
  marginLeft: spacing.md,
  marginRight: spacing.md,
};

const darkStyles = StyleSheet.create({
  outer: { marginBottom: spacing.xl },
  section: { ...baseSection, backgroundColor: iosListGroup.sectionBackground },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: iosListGroup.separator,
    marginLeft: spacing.md,
  },
  header: { ...baseHeader, color: iosListGroup.sectionHeader },
  footer: { ...baseFooter, color: iosListGroup.sectionHeader },
});

const lightStyles = StyleSheet.create({
  outer: { marginBottom: spacing.xl },
  section: { ...baseSection, backgroundColor: '#FFFFFF' },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(60,60,67,0.18)',
    marginLeft: spacing.md,
  },
  header: { ...baseHeader, color: '#6C6C70' },
  footer: { ...baseFooter, color: '#6C6C70' },
});
