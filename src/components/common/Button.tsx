import React from 'react';
import {
  Pressable,
  Text,
  StyleSheet,
  ActivityIndicator,
  type ViewStyle,
  type TextStyle,
} from 'react-native';
import { colors, spacing, typography } from '../../constants/theme';
import { useTheme } from '../../contexts/ThemeContext';
import { GlassView } from './GlassView';
import { SFSymbol } from './SFSymbol';

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  icon?: string;
  style?: ViewStyle;
}

const sizeStyles: Record<
  ButtonSize,
  { paddingVertical: number; paddingHorizontal: number; text: TextStyle }
> = {
  sm: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    text: typography.caption,
  },
  md: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    text: typography.body,
  },
  lg: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    text: typography.subtitle,
  },
};

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  icon,
  style,
}: ButtonProps) {
  const { colors, isDark } = useTheme();
  const sizeStyle = sizeStyles[size];
  const isOutline = variant === 'outline';
  const isGhost = variant === 'ghost';
  const isFilled = variant === 'primary' || variant === 'secondary';
  const textColor = isGhost ? colors.primary : isOutline ? colors.primary : '#FFFFFF';
  const iconColor = textColor;

  const content = (
    <>
      {loading ? (
        <ActivityIndicator color={textColor} size="small" />
      ) : (
        <>
          {icon && <SFSymbol name={icon} size={16} tintColor={iconColor} style={styles.icon} />}
          <Text style={[styles.text, sizeStyle.text, { color: textColor }]}>{title}</Text>
        </>
      )}
    </>
  );

  if (isFilled || isOutline) {
    return (
      <Pressable
        onPress={onPress}
        disabled={disabled || loading}
        style={({ pressed }) => [
          styles.base,
          { opacity: disabled || loading ? 0.5 : pressed ? 0.85 : 1 },
          style,
        ]}
      >
        <GlassView
          isInteractive
          material={isOutline ? 'clear' : 'regular'}
          style={[
            styles.glass,
            {
              paddingVertical: sizeStyle.paddingVertical,
              paddingHorizontal: sizeStyle.paddingHorizontal,
              borderColor: isOutline ? colors.border : undefined,
              borderWidth: isOutline ? StyleSheet.hairlineWidth : 0,
              backgroundColor:
                variant === 'primary' ? colors.primary + (isDark ? 'CC' : 'E6') : undefined,
            },
          ]}
        >
          {content}
        </GlassView>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.base,
        styles.ghost,
        { opacity: disabled || loading ? 0.5 : pressed ? 0.7 : 1 },
        style,
      ]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 999,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  glass: {
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  ghost: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    gap: spacing.xs,
  },
  text: {
    fontWeight: '600',
  },
  icon: {
    marginRight: spacing.xs,
  },
});
