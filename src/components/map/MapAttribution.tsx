import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MAX_FONT_SCALE_CHROME } from '../../constants/a11y';
import type { SentinelScene } from '../../services/map/sentinelStac';

interface MapAttributionProps {
  /** Attribution strings for the currently visible imagery sources. */
  attributions: string[];
  /** Freshest Sentinel-2 scene over the viewport, when known. */
  latestScene?: SentinelScene | null;
  /** Bottom offset (safe-area aware), supplied by the host. */
  bottomInset?: number;
}

function formatSceneDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso.slice(0, 10) : date.toISOString().slice(0, 10);
}

/**
 * Attribution control for the satellite imagery layers.
 *
 * MapLibre's own attribution is disabled app-wide, but the satellite style's
 * per-source attribution must still be surfaced. A compact pill opens a panel
 * listing the attributions of the currently visible imagery sources, plus the
 * freshest Sentinel-2 acquisition date discovered for the viewport.
 */
export function MapAttribution({
  attributions,
  latestScene,
  bottomInset = 12,
}: MapAttributionProps) {
  const [open, setOpen] = useState(false);
  if (attributions.length === 0) return null;

  return (
    <View style={[styles.container, { bottom: bottomInset }]} pointerEvents="box-none">
      <Pressable
        style={styles.pill}
        onPress={() => setOpen(true)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Map imagery attribution"
      >
        <Ionicons name="information-circle-outline" size={14} color="#FFFFFF" />
        <Text style={styles.pillText} maxFontSizeMultiplier={MAX_FONT_SCALE_CHROME}>
          Imagery
        </Text>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable
          style={styles.backdrop}
          onPress={() => setOpen(false)}
          accessibilityRole="button"
          accessibilityLabel="Close attribution"
        >
          <View style={styles.card}>
            <Text style={styles.cardTitle} maxFontSizeMultiplier={MAX_FONT_SCALE_CHROME}>
              Imagery attribution
            </Text>
            {latestScene && (
              <Text style={styles.scene} maxFontSizeMultiplier={MAX_FONT_SCALE_CHROME}>
                Latest Sentinel-2: {formatSceneDate(latestScene.datetime)}
                {latestScene.cloudCover != null
                  ? ` · ${latestScene.cloudCover.toFixed(1)}% cloud`
                  : ''}
              </Text>
            )}
            <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
              {attributions.map((attribution) => (
                <Text
                  key={attribution}
                  style={styles.item}
                  maxFontSizeMultiplier={MAX_FONT_SCALE_CHROME}
                >
                  • {attribution}
                </Text>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    right: 12,
    alignItems: 'flex-end',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: 'rgba(28,28,30,0.72)',
  },
  pillText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '70%',
    borderRadius: 14,
    padding: 16,
    backgroundColor: 'rgba(28,28,30,0.96)',
  },
  cardTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 8,
  },
  scene: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 12,
    marginBottom: 10,
  },
  list: {
    flexGrow: 0,
  },
  listContent: {
    gap: 6,
  },
  item: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 13,
    lineHeight: 18,
  },
});
