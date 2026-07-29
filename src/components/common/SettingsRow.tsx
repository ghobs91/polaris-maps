import React, { type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type ViewStyle, type TextStyle } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { spacing, typography, iosListGroup } from '../../constants/theme';

interface SettingsRowProps {
  /** Primary left-aligned text (e.g. "Voice Guidance"). */
  title: string;
  /** Optional right-aligned text (current value, status). */
  value?: string;
  /** Optional SF Symbol-style icon to show on the left. */
  icon?: ReactNode;
  /** Optional icon background tint (e.g. '#FF3B30' for destructive). */
  iconColor?: string;
  /** Tappable row handler. If omitted, the row is non-interactive. */
  onPress?: () => void;
  /** When true, the title is rendered in the destructive (red) color. */
  destructive?: boolean;
  /** Custom right-side slot (e.g. a `<Switch />`) — overrides `value`. */
  rightAdornment?: ReactNode;
  /** Optional last row in a section (no separator below) — handled by parent. */
  style?: ViewStyle;
}

/**
 * A single tappable row inside a `SettingsGroup`.
 *
 * Matches the iOS Settings list: tall row, label left, accessory right, hairline
 * separator supplied by the parent `SettingsGroup`.
 */
export function SettingsRow({
  title,
  value,
  icon,
  iconColor,
  onPress,
  destructive,
  rightAdornment,
  style,
}: SettingsRowProps) {
  const { isDark, colors } = useTheme();
  const styles = isDark ? darkStyles : lightStyles;
  const titleColor = destructive ? iosListGroup.destructive : colors.text;

  const content = (
    <View style={[styles.row, style]}>
      {icon ? (
        <View style={[styles.icon, { backgroundColor: iconColor ?? colors.primary }]}>{icon}</View>
      ) : null}
      <Text
        style={[styles.title, { color: titleColor }, destructive ? styles.titleDestructive : null]}
        numberOfLines={1}
      >
        {title}
      </Text>
      {rightAdornment ? (
        <View style={styles.right}>{rightAdornment}</View>
      ) : value ? (
        <Text style={styles.value} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
    </View>
  );

  if (!onPress) {
    return content;
  }

  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: iosListGroup.pressedOverlay }}
      style={({ pressed }) => [pressed ? styles.pressed : null]}
    >
      {content}
    </Pressable>
  );
}

const rowBase: ViewStyle = {
  minHeight: 44,
  paddingHorizontal: spacing.md,
  flexDirection: 'row',
  alignItems: 'center',
  gap: spacing.md,
};

const titleBase: TextStyle = {
  ...typography.body,
  fontSize: 17,
  flex: 1,
};

const iconBase: ViewStyle = {
  width: 28,
  height: 28,
  borderRadius: 6,
  borderCurve: 'continuous',
  alignItems: 'center',
  justifyContent: 'center',
};

const darkStyles = StyleSheet.create({
  row: rowBase,
  pressed: { backgroundColor: iosListGroup.pressedOverlay },
  title: titleBase,
  titleDestructive: { color: iosListGroup.destructive },
  value: { ...typography.body, fontSize: 17, color: iosListGroup.sectionHeader },
  icon: iconBase,
  right: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
});

const lightStyles = StyleSheet.create({
  row: rowBase,
  pressed: { backgroundColor: 'rgba(0,0,0,0.04)' },
  title: titleBase,
  titleDestructive: { color: '#FF3B30' },
  value: { ...typography.body, fontSize: 17, color: '#6C6C70' },
  icon: iconBase,
  right: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
});
