import React, { useEffect, useRef } from 'react';
import { Animated, View, StyleSheet, type ViewStyle } from 'react-native';
import { colors, borderRadius, spacing } from '../../constants/theme';

interface SkeletonScreenProps {
  lines?: number;
  style?: ViewStyle;
}

export function SkeletonScreen({ lines = 3, style }: SkeletonScreenProps) {
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 800, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [opacity]);

  return (
    <View style={[styles.container, style]}>
      <Animated.View style={[styles.headerLine, { opacity }]} />
      {Array.from({ length: lines }).map((_, i) => (
        <Animated.View
          key={i}
          style={[styles.line, i === lines - 1 && styles.shortLine, { opacity }]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.md,
  },
  headerLine: {
    height: 20,
    width: '60%',
    backgroundColor: colors.border,
    borderRadius: borderRadius.sm,
    marginBottom: spacing.md,
  },
  line: {
    height: 14,
    width: '100%',
    backgroundColor: colors.border,
    borderRadius: borderRadius.sm,
    marginBottom: spacing.sm,
  },
  shortLine: {
    width: '40%',
  },
});
