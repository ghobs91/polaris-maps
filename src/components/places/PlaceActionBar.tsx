import React, { useMemo } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassView } from '../common/GlassView';
import { spacing } from '../../constants/theme';
import { useTheme } from '../../contexts/ThemeContext';

export interface PlaceActionBarAction {
  key: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  /** Accessibility label (the bar is icon-only, Apple Maps style). */
  label: string;
  onPress: () => void;
  /** Tint the glyph as selected (e.g. an active edit mode). */
  active?: boolean;
}

interface PlaceActionBarProps {
  actions: PlaceActionBarAction[];
}

/**
 * Floating liquid-glass action pill pinned to the bottom of a screen, matching
 * the toolbar in Apple Maps' Guides (add / sort / edit). Sits above the home
 * indicator and lets the list content scroll underneath it.
 */
export function PlaceActionBar({ actions }: PlaceActionBarProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View
      style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}
      pointerEvents="box-none"
    >
      <GlassView material="regular" style={styles.bar}>
        {actions.map((action) => (
          <Pressable
            key={action.key}
            onPress={action.onPress}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            accessibilityState={action.active ? { selected: true } : undefined}
            hitSlop={6}
            style={({ pressed }) => [styles.button, pressed && styles.pressed]}
          >
            <Ionicons
              name={action.icon}
              size={22}
              color={action.active ? colors.primary : colors.text}
            />
          </Pressable>
        ))}
      </GlassView>
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    wrap: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: 'center',
    },
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      borderRadius: 999,
      borderCurve: 'continuous',
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.glass.border,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.18,
      shadowRadius: 14,
      elevation: 6,
    },
    button: {
      width: 48,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 999,
    },
    pressed: {
      opacity: 0.55,
    },
  });
