import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, borderRadius } from '../../constants/theme';

export type TransportMode = 'drive' | 'transit' | 'walk' | 'park-and-ride';

interface TransportModeSelectorProps {
  selected: TransportMode;
  onSelect: (mode: TransportMode) => void;
  showParkAndRide?: boolean;
  isDark: boolean;
}

const MODES: Array<{
  key: TransportMode;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
}> = [
  { key: 'drive', icon: 'car', label: 'Drive' },
  { key: 'transit', icon: 'train', label: 'Transit' },
  { key: 'walk', icon: 'walk', label: 'Walk' },
  { key: 'park-and-ride', icon: 'swap-horizontal', label: 'Park & Ride' },
];

export function TransportModeSelector({
  selected,
  onSelect,
  showParkAndRide = false,
  isDark,
}: TransportModeSelectorProps) {
  const activeBg = isDark ? 'rgba(64,156,255,0.25)' : 'rgba(0,122,255,0.12)';
  const inactiveBg = isDark ? 'rgba(50,50,70,0.5)' : 'rgba(230,230,240,0.8)';
  const activeText = isDark ? '#409CFF' : '#007AFF';
  const inactiveText = isDark ? '#A0A0B8' : '#8E8E93';

  const visibleModes = showParkAndRide ? MODES : MODES.filter((m) => m.key !== 'park-and-ride');

  return (
    <View style={styles.container}>
      {visibleModes.map((mode) => {
        const isActive = selected === mode.key;
        return (
          <TouchableOpacity
            key={mode.key}
            style={[
              styles.pill,
              { backgroundColor: isActive ? activeBg : inactiveBg },
              isActive && { borderColor: activeText, borderWidth: 1.5 },
            ]}
            onPress={() => onSelect(mode.key)}
            activeOpacity={0.7}
          >
            <Ionicons name={mode.icon} size={16} color={isActive ? activeText : inactiveText} />
            <Text style={[styles.label, { color: isActive ? activeText : inactiveText }]}>
              {mode.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginVertical: spacing.xs,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: borderRadius.lg,
    gap: 4,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
  },
});
