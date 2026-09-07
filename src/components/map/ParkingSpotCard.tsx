import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useParkingStore } from '../../stores/parkingStore';
import { useMapStore } from '../../stores/mapStore';
import { GlassView } from '../common/GlassView';
import { spacing } from '../../constants/theme';

function formatParkedDuration(savedAt: number): string {
  const mins = Math.max(1, Math.round((Date.now() - savedAt) / 60000));
  if (mins < 60) return `Parked ${mins}m ago`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem === 0 ? `Parked ${hours}h ago` : `Parked ${hours}h ${rem}m ago`;
}

/** Floating card shown when a parking spot is saved. */
export function ParkingSpotCard(): React.ReactElement | null {
  const insets = useSafeAreaInsets();
  const spot = useParkingStore((s) => s.spot);
  const clearSpot = useParkingStore((s) => s.clearSpot);
  const locateTo = useMapStore((s) => s.locateTo);
  const setPendingDirectionsTarget = useMapStore((s) => s.setPendingDirectionsTarget);

  const subtitle = spot ? formatParkedDuration(spot.savedAt) : '';

  if (!spot) return null;

  return (
    <View style={[styles.container, { bottom: insets.bottom + spacing.md + 150 }]}>
      <GlassView material="regular" style={styles.card}>
        <View style={styles.iconWrap}>
          <Ionicons name="car-sport" size={20} color="#0A84FF" />
        </View>
        <View style={styles.textWrap}>
          <Text style={styles.title}>My parked car</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
        <TouchableOpacity
          accessibilityLabel="Navigate to parked car"
          accessibilityRole="button"
          style={styles.goBtn}
          activeOpacity={0.7}
          onPress={() => {
            locateTo(spot.lat, spot.lng, 17);
            setPendingDirectionsTarget({ lat: spot.lat, lng: spot.lng, name: 'My parked car' });
          }}
        >
          <Ionicons name="navigate" size={16} color="#fff" />
          <Text style={styles.goText}>Go</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityLabel="Clear parking spot"
          accessibilityRole="button"
          style={styles.clearBtn}
          activeOpacity={0.7}
          onPress={() => clearSpot()}
        >
          <Ionicons name="close" size={16} color="#8E8E93" />
        </TouchableOpacity>
      </GlassView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: spacing.md,
    right: 76,
    zIndex: 15,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 16,
    overflow: 'hidden',
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(10,132,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  textWrap: { flex: 1 },
  title: { color: '#fff', fontSize: 14, fontWeight: '600' },
  subtitle: { color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 1 },
  goBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#0A84FF',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
  },
  goText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  clearBtn: { padding: 6 },
});
