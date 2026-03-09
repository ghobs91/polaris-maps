import React from 'react';
import { View, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { spacing, shadow } from '../../constants/theme';

interface MapControlsProps {
  onLocatePress: () => void;
}

function GlassButton({ onPress, icon }: { onPress: () => void; icon: string }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} style={styles.buttonOuter}>
      {Platform.OS === 'ios' ? (
        <BlurView intensity={60} tint="systemChromeMaterial" style={styles.button}>
          <Ionicons name={icon as any} size={22} color="#333" />
        </BlurView>
      ) : (
        <View style={[styles.button, styles.buttonAndroid]}>
          <Ionicons name={icon as any} size={22} color="#333" />
        </View>
      )}
    </TouchableOpacity>
  );
}

export function MapControls({ onLocatePress }: MapControlsProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { bottom: insets.bottom + 200 }]}>
      <GlassButton onPress={onLocatePress} icon="locate" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    right: spacing.md,
    gap: spacing.sm,
  },
  buttonOuter: {
    borderRadius: 999,
    overflow: 'hidden',
    ...shadow.md,
  },
  button: {
    width: 48,
    height: 48,
    borderRadius: 999,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  buttonAndroid: {
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
});
