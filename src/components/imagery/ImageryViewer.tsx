import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, Image, Pressable, FlatList, Dimensions } from 'react-native';
import { colors, spacing, typography, borderRadius } from '../../constants/theme';
import type { StreetImagery } from '../../models/imagery';

const SCREEN_WIDTH = Dimensions.get('window').width;

interface ImageryViewerProps {
  images: StreetImagery[];
  initialIndex?: number;
  onClose?: () => void;
  getImageUri?: (image: StreetImagery) => string | null;
}

export function ImageryViewer({
  images,
  initialIndex = 0,
  onClose,
  getImageUri,
}: ImageryViewerProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const current = images[currentIndex];

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: Array<{ index: number | null }> }) => {
      if (viewableItems.length > 0 && viewableItems[0].index != null) {
        setCurrentIndex(viewableItems[0].index);
      }
    },
    [],
  );

  if (!current) return null;

  const date = new Date(current.capturedAt * 1000);
  const dateStr = date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <View style={styles.container}>
      <FlatList
        data={images}
        horizontal
        pagingEnabled
        initialScrollIndex={initialIndex}
        keyExtractor={(item) => item.id}
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={{ viewAreaCoveragePercentThreshold: 50 }}
        getItemLayout={(_, index) => ({
          length: SCREEN_WIDTH,
          offset: SCREEN_WIDTH * index,
          index,
        })}
        renderItem={({ item }) => {
          const uri = getImageUri?.(item);
          return (
            <View style={styles.imageContainer}>
              {uri ? (
                <Image source={{ uri }} style={styles.image} resizeMode="contain" />
              ) : (
                <View style={styles.placeholder}>
                  <Text style={styles.placeholderText}>Loading image…</Text>
                </View>
              )}
            </View>
          );
        }}
      />

      <View style={styles.overlay}>
        <View style={styles.infoBar}>
          <View style={styles.bearingIndicator}>
            <Text style={styles.bearingText}>{current.bearing}°</Text>
          </View>
          <Text style={styles.dateText}>{dateStr}</Text>
          <Text style={styles.counter}>
            {currentIndex + 1} / {images.length}
          </Text>
        </View>

        {onClose && (
          <Pressable style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeBtnText}>✕</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  imageContainer: { width: SCREEN_WIDTH, justifyContent: 'center', alignItems: 'center' },
  image: { width: SCREEN_WIDTH, height: '100%' },
  placeholder: {
    width: SCREEN_WIDTH,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderText: { color: '#888', ...typography.body },
  overlay: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: spacing.lg },
  infoBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: borderRadius.md,
    padding: spacing.sm,
  },
  bearingIndicator: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.round,
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bearingText: { color: '#FFF', fontWeight: '700', fontSize: 12 },
  dateText: { color: '#FFF', ...typography.caption },
  counter: { color: '#FFF', ...typography.caption },
  closeBtn: {
    position: 'absolute',
    top: -400,
    right: spacing.lg,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: borderRadius.round,
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeBtnText: { color: '#FFF', fontSize: 18, fontWeight: '700' },
});
