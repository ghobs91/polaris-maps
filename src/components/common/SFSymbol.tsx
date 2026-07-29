import React from 'react';
import { type StyleProp, type TextStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export interface SFSymbolProps {
  /** SF Symbol name (without the `sf:` prefix). */
  name: string;
  /** Symbol tint color. */
  tintColor?: string | null;
  size?: number;
  style?: StyleProp<TextStyle>;
}

/**
 * Renders an Apple SF Symbol on iOS, falling back to an Ionicons equivalent on other platforms.
 * Use this instead of Ionicons/MaterialCommunityIcons for a native Liquid Glass look.
 */
const SF_TO_IONICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  'xmark.circle.fill': 'close-circle',
};

export function SFSymbol({ name, size = 22, tintColor, style }: SFSymbolProps) {
  const ionName = SF_TO_IONICONS[name] ?? 'help-circle';
  return <Ionicons name={ionName} size={size} color={tintColor ?? '#000000'} style={style} />;
}
