import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Switch, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMapStore } from '../../stores/mapStore';
import { useTransitStore } from '../../stores/transitStore';
import { useTheme } from '../../contexts/ThemeContext';
import { spacing, borderRadius, shadow } from '../../constants/theme';

export function MapLayerToggle() {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const { isDark } = useTheme();
  const trafficLayerVisible = useMapStore((s) => s.trafficLayerVisible);
  const setTrafficLayerVisible = useMapStore((s) => s.setTrafficLayerVisible);
  const transitLayerVisible = useTransitStore((s) => s.transitLayerVisible);
  const setTransitLayerVisible = useTransitStore((s) => s.setTransitLayerVisible);
  const mapStyle = useMapStore((s) => s.mapStyle);
  const setMapStyle = useMapStore((s) => s.setMapStyle);

  const iconColor = isDark ? '#E0E0E0' : '#333';

  return (
    <View style={[styles.container, { top: insets.top + spacing.sm }]}>
      <TouchableOpacity
        onPress={() => setOpen((v) => !v)}
        activeOpacity={0.7}
        style={styles.buttonOuter}
      >
        {Platform.OS === 'ios' ? (
          <BlurView
            intensity={60}
            tint={isDark ? 'dark' : 'systemChromeMaterial'}
            style={styles.button}
          >
            <Ionicons name="layers" size={22} color={iconColor} />
          </BlurView>
        ) : (
          <View style={[styles.button, isDark ? styles.buttonAndroidDark : styles.buttonAndroid]}>
            <Ionicons name="layers" size={22} color={iconColor} />
          </View>
        )}
      </TouchableOpacity>

      {open &&
        (Platform.OS === 'ios' ? (
          <View style={[styles.cardWrapper, shadow.lg]}>
            <BlurView
              intensity={60}
              tint={isDark ? 'dark' : 'systemChromeMaterial'}
              style={StyleSheet.absoluteFill}
            />
            <View style={styles.cardInner}>
              <CardContent
                isDark={isDark}
                trafficVisible={trafficLayerVisible}
                onTrafficToggle={setTrafficLayerVisible}
                transitVisible={transitLayerVisible}
                onTransitToggle={setTransitLayerVisible}
                mapStyle={mapStyle}
                onMapStyleChange={setMapStyle}
              />
            </View>
          </View>
        ) : (
          <View
            style={[
              styles.cardWrapper,
              isDark ? styles.cardAndroidDark : styles.cardAndroid,
              shadow.lg,
            ]}
          >
            <View style={styles.cardInner}>
              <CardContent
                isDark={isDark}
                trafficVisible={trafficLayerVisible}
                onTrafficToggle={setTrafficLayerVisible}
                transitVisible={transitLayerVisible}
                onTransitToggle={setTransitLayerVisible}
                mapStyle={mapStyle}
                onMapStyleChange={setMapStyle}
              />
            </View>
          </View>
        ))}
    </View>
  );
}

function CardContent({
  isDark,
  trafficVisible,
  onTrafficToggle,
  transitVisible,
  onTransitToggle,
  mapStyle,
  onMapStyleChange,
}: {
  isDark: boolean;
  trafficVisible: boolean;
  onTrafficToggle: (v: boolean) => void;
  transitVisible: boolean;
  onTransitToggle: (v: boolean) => void;
  mapStyle: 'default' | 'satellite' | 'terrain';
  onMapStyleChange: (style: 'default' | 'satellite' | 'terrain') => void;
}) {
  const textColor = isDark ? '#E0E0E0' : '#333';
  const subtextColor = isDark ? '#A0A0B8' : '#666';
  const chipBg = isDark ? '#3A3A58' : '#E8E8F0';
  const chipActiveBg = isDark ? '#409CFF' : '#007AFF';

  return (
    <>
      <Text style={[styles.cardTitle, { color: textColor }]}>Map Layers</Text>

      {/* Map style selector */}
      <Text style={[styles.sectionLabel, { color: subtextColor }]}>Map Type</Text>
      <View style={styles.chipRow}>
        <TouchableOpacity
          style={[styles.chip, { backgroundColor: mapStyle === 'default' ? chipActiveBg : chipBg }]}
          onPress={() => onMapStyleChange('default')}
          activeOpacity={0.7}
        >
          <Ionicons
            name="map-outline"
            size={16}
            color={mapStyle === 'default' ? '#FFF' : textColor}
          />
          <Text style={[styles.chipLabel, { color: mapStyle === 'default' ? '#FFF' : textColor }]}>
            Default
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.chip,
            { backgroundColor: mapStyle === 'satellite' ? chipActiveBg : chipBg },
          ]}
          onPress={() => onMapStyleChange('satellite')}
          activeOpacity={0.7}
        >
          <Ionicons
            name="earth-outline"
            size={16}
            color={mapStyle === 'satellite' ? '#FFF' : textColor}
          />
          <Text
            style={[styles.chipLabel, { color: mapStyle === 'satellite' ? '#FFF' : textColor }]}
          >
            Satellite
          </Text>
        </TouchableOpacity>
      </View>

      {/* Traffic toggle */}
      <View style={styles.divider} />
      <View style={styles.row}>
        <Ionicons name="car" size={18} color="#FF9500" style={styles.rowIcon} />
        <Text style={[styles.rowLabel, { color: textColor }]}>Traffic</Text>
        <Switch
          value={trafficVisible}
          onValueChange={onTrafficToggle}
          trackColor={{ false: isDark ? '#555' : '#767577', true: isDark ? '#409CFF' : '#007AFF' }}
        />
      </View>

      {/* Transit toggle */}
      <View style={styles.divider} />
      <View style={styles.row}>
        <Ionicons name="bus" size={18} color="#1A5BA5" style={styles.rowIcon} />
        <Text style={[styles.rowLabel, { color: textColor }]}>Transit</Text>
        <Switch
          value={transitVisible}
          onValueChange={onTransitToggle}
          trackColor={{ false: isDark ? '#555' : '#767577', true: isDark ? '#409CFF' : '#007AFF' }}
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
  buttonAndroidDark: {
    backgroundColor: 'rgba(40,40,60,0.92)',
  },
  cardWrapper: {
    marginTop: spacing.sm,
    borderRadius: borderRadius.lg,
    minWidth: 200,
    overflow: 'hidden',
  },
  cardInner: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  cardAndroid: {
    backgroundColor: 'rgba(255,255,255,0.95)',
  },
  cardAndroidDark: {
    backgroundColor: 'rgba(30,30,50,0.95)',
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 10,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 6,
  },
  chipRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 4,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: borderRadius.md,
    gap: 5,
  },
  chipLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(128,128,128,0.3)',
    marginVertical: 10,
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
  },
});
