import React from 'react';
import { Platform } from 'react-native';
import { Image, type ImageProps } from 'expo-image';

export interface SymbolProps extends Omit<ImageProps, 'source' | 'tintColor'> {
  /** SF Symbol name (without the `sf:` prefix). */
  name: string;
  /** Symbol tint color. */
  tintColor?: string | null;
  size?: number;
}

/**
 * Renders an Apple SF Symbol on iOS, falling back to an empty view on other platforms.
 * Use this instead of Ionicons/MaterialCommunityIcons for a native Liquid Glass look.
 */
export function Symbol({ name, size = 22, tintColor, style, ...rest }: SymbolProps) {
  if (Platform.OS !== 'ios') {
    return null;
  }

  return (
    <Image
      source={`sf:${name}` as const}
      style={[{ width: size, height: size }, style]}
      tintColor={tintColor}
      contentFit="contain"
      {...rest}
    />
  );
}
