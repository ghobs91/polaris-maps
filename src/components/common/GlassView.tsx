import React, { useMemo } from 'react';
import { Platform, StyleSheet, type ViewProps } from 'react-native';
import { BlurView } from 'expo-blur';
import { GlassView as NativeGlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useTheme } from '../../contexts/ThemeContext';

export type GlassMaterial = 'clear' | 'regular' | 'none';

export interface GlassViewProps extends ViewProps {
  /** Liquid Glass style. Defaults to 'regular'. */
  material?: GlassMaterial;
  /** Whether this glass surface is tappable. Adds the system liquid-glass highlight on iOS 26+. */
  isInteractive?: boolean;
  /** Override the color scheme. */
  colorScheme?: 'auto' | 'light' | 'dark';
}

/**
 * Adaptive glass surface.
 *
 * - On iOS 26+ uses the native Liquid Glass effect via `expo-glass-effect`.
 * - On older iOS/Android falls back to `expo-blur` system materials.
 */
export function GlassView({
  children,
  material = 'regular',
  isInteractive = false,
  colorScheme = 'auto',
  style,
  ...rest
}: GlassViewProps) {
  const { isDark, colors } = useTheme();

  const effectiveColorScheme = useMemo(
    () => (colorScheme === 'auto' ? (isDark ? 'dark' : 'light') : colorScheme),
    [colorScheme, isDark],
  );

  const glassBackgroundColor = useMemo(() => {
    if (material === 'none') return undefined;
    if (material === 'clear') {
      return isDark ? 'rgba(28,28,30,0.42)' : 'rgba(255,255,255,0.5)';
    }
    return colors.glass.background;
  }, [material, isDark, colors.glass.background]);

  const glassStyle = useMemo(() => {
    return glassBackgroundColor ? [{ backgroundColor: glassBackgroundColor }, style] : style;
  }, [glassBackgroundColor, style]);

  if (Platform.OS === 'ios' && isLiquidGlassAvailable()) {
    return (
      <NativeGlassView
        glassEffectStyle={material}
        isInteractive={isInteractive}
        colorScheme={effectiveColorScheme}
        style={glassStyle}
        {...rest}
      >
        {children}
      </NativeGlassView>
    );
  }

  return (
    <BlurView
      // `intensity` is blur strength, not opacity: a thin material plus a
      // translucent fill is what gives Apple Maps glass its see-through look.
      intensity={material === 'clear' ? 40 : material === 'none' ? 0 : 70}
      tint={
        isDark
          ? material === 'clear'
            ? 'systemUltraThinMaterialDark'
            : 'systemThinMaterialDark'
          : material === 'clear'
            ? 'systemUltraThinMaterialLight'
            : 'systemThinMaterialLight'
      }
      // Android has no blur target wired here, so it keeps the translucent
      // fill only (expo-blur falls back to `blurMethod="none"` regardless).
      style={[styles.blur, glassStyle]}
      {...rest}
    >
      {children}
    </BlurView>
  );
}

const styles = StyleSheet.create({
  blur: {
    overflow: 'hidden',
  },
});
