import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { colors, spacing } from '../../constants/theme';

interface RatingWidgetProps {
  value?: number;
  onChange?: (rating: number) => void;
  readonly?: boolean;
  size?: number;
}

export function RatingWidget({
  value = 0,
  onChange,
  readonly = false,
  size = 32,
}: RatingWidgetProps) {
  const [hovered, setHovered] = useState(0);
  const display = hovered || value;

  return (
    <View
      style={styles.container}
      accessibilityRole="adjustable"
      accessibilityLabel={`Rating: ${value} of 5`}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <Pressable
          key={star}
          onPress={() => !readonly && onChange?.(star)}
          onPressIn={() => !readonly && setHovered(star)}
          onPressOut={() => setHovered(0)}
          disabled={readonly}
          hitSlop={4}
          accessibilityLabel={`${star} star${star !== 1 ? 's' : ''}`}
        >
          <Text
            style={[
              styles.star,
              { fontSize: size, color: star <= display ? colors.warning : colors.border },
            ]}
          >
            ★
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  star: {
    lineHeight: 40,
  },
});
