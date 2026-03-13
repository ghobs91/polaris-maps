import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Switch, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMapStore } from '../../stores/mapStore';
import { spacing, borderRadius, shadow } from '../../constants/theme';

export function MapLayerToggle() {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const trafficLayerVisible = useMapStore((s) => s.trafficLayerVisible);
  const setTrafficLayerVisible = useMapStore((s) => s.setTrafficLayerVisible);

  return (
    <View style={[styles.container, { top: insets.top + spacing.sm }]}>
      <TouchableOpacity
        onPress={() => setOpen((v) => !v)}
        activeOpacity={0.7}
        style={styles.buttonOuter}
      >
        {Platform.OS === 'ios' ? (
          <BlurView intensity={60} tint="systemChromeMaterial" style={styles.button}>
            <Ionicons name="layers" size={22} color="#333" />
          </BlurView>
        ) : (
          <View style={[styles.button, styles.buttonAndroid]}>
            <Ionicons name="layers" size={22} color="#333" />
          </View>
        )}
      </TouchableOpacity>

      {open &&
        (Platform.OS === 'ios' ? (
          <BlurView intensity={60} tint="systemChromeMaterial" style={styles.card}>
            <CardContent
              trafficVisible={trafficLayerVisible}
              onTrafficToggle={setTrafficLayerVisible}
            />
          </BlurView>
        ) : (
          <View style={[styles.card, styles.cardAndroid]}>
            <CardContent
              trafficVisible={trafficLayerVisible}
              onTrafficToggle={setTrafficLayerVisible}
            />
          </View>
        ))}
    </View>
  );
}

function CardContent({
  trafficVisible,
  onTrafficToggle,
}: {
  trafficVisible: boolean;
  onTrafficToggle: (v: boolean) => void;
}) {
  return (
    <>
      <Text style={styles.cardTitle}>Map Layers</Text>
      <View style={styles.row}>
        <Ionicons name="car" size={18} color="#FF9500" style={styles.rowIcon} />
        <Text style={styles.rowLabel}>Traffic</Text>
        <Switch
          value={trafficVisible}
          onValueChange={onTrafficToggle}
          trackColor={{ false: '#767577', true: '#007AFF' }}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    right: spacing.md,
    alignItems: 'flex-end',
    zIndex: 30,
    elevation: 30,
  },
  buttonOuter: {
    borderRadius: borderRadius.full,
    overflow: 'hidden',
    ...shadow.md,
  },
  button: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.full,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  buttonAndroid: {
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  card: {
    marginTop: spacing.sm,
    borderRadius: borderRadius.lg,
    paddingVertical: 12,
    paddingHorizontal: 16,
    minWidth: 200,
    overflow: 'hidden',
    ...shadow.lg,
  },
  cardAndroid: {
    backgroundColor: 'rgba(255,255,255,0.95)',
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowIcon: {
    marginRight: 8,
  },
  rowLabel: {
    flex: 1,
    fontSize: 15,
    color: '#333',
  },
});
