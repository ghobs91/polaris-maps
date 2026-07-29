import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { spacing } from '../../constants/theme';
import { GlassView } from '../common/GlassView';

interface MapControlsProps {
  onLocatePress: () => void;
}

function GlassButton({ onPress, icon }: { onPress: () => void; icon: string }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} style={styles.buttonOuter}>
      <GlassView material="clear" isInteractive style={styles.button}>
        <Ionicons name={icon as any} size={22} color="#333" />
      </GlassView>
    </TouchableOpacity>
  );
}

export function MapControls({ onLocatePress }: MapControlsProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { bottom: insets.bottom + 100 }]}>
      <GlassButton onPress={onLocatePress} icon="locate" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    right: spacing.md,
    gap: spacing.sm,
    zIndex: 20,
  },
  buttonOuter: {
    borderRadius: 999,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  button: {
    width: 48,
    height: 48,
    borderRadius: 999,
    borderCurve: 'continuous',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
});
