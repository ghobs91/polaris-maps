import React, { memo, useCallback, useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { spacing, typography } from '../../constants/theme';
import { useTheme } from '../../contexts/ThemeContext';
import { useThemedStyles, type Theme } from '../../hooks/useThemedStyles';
import { resolveReviewMediaUri } from '../../services/poi/reviewMediaService';
import { isMediaVisible } from '../../services/poi/reviewMediaStatus';
import type { ReviewMedia } from '../../models/review';

interface ReviewPhotoGalleryProps {
  media: readonly ReviewMedia[];
  onReportPhoto?: (hash: string) => void;
  onHidePhoto?: (hash: string) => void;
}

interface ResolvedMedia {
  hash: string;
  width: number;
  height: number;
  thumbUri: string | null;
  fullUri: string | null;
}

/**
 * Local-first review photo strip with a full-size pager. Reported/hidden media
 * is withheld, and missing local bytes fall back to a placeholder rather than a
 * broken image.
 */
export const ReviewPhotoGallery = memo(function ReviewPhotoGallery({
  media,
  onReportPhoto,
  onHidePhoto,
}: ReviewPhotoGalleryProps) {
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();

  const visible = media.filter((item) => isMediaVisible(item.status));
  const [resolved, setResolved] = useState<ResolvedMedia[]>([]);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const items = await Promise.all(
        visible.map(async (item) => ({
          hash: item.hash,
          width: item.width,
          height: item.height,
          thumbUri: await resolveReviewMediaUri(item.hash, 'thumb'),
          fullUri: await resolveReviewMediaUri(item.hash, 'full'),
        })),
      );
      if (!cancelled) setResolved(items);
    })();
    return () => {
      cancelled = true;
    };
    // Re-resolve when the identity or ordering of the media changes.
  }, [visible.map((item) => item.hash).join(',')]);

  const closeViewer = useCallback(() => setViewerIndex(null), []);
  const current = viewerIndex !== null ? resolved[viewerIndex] : undefined;

  if (visible.length === 0) return null;

  return (
    <View style={styles.strip} testID="review-photo-strip">
      {resolved.map((item, index) => (
        <Pressable
          key={item.hash}
          testID={`review-photo-thumb-${item.hash}`}
          accessibilityRole="button"
          accessibilityLabel={`Review photo ${index + 1} of ${resolved.length}`}
          onPress={() => setViewerIndex(index)}
          style={styles.thumbWrap}
        >
          {item.thumbUri ? (
            <Image
              source={{ uri: item.thumbUri }}
              style={styles.thumb}
              contentFit="cover"
              accessibilityIgnoresInvertColors
            />
          ) : (
            <View style={[styles.thumb, styles.placeholder]}>
              <Ionicons name="image-outline" size={20} color={colors.textSecondary} />
            </View>
          )}
        </Pressable>
      ))}

      <Modal
        visible={viewerIndex !== null}
        transparent
        animationType="fade"
        onRequestClose={closeViewer}
      >
        <View style={styles.viewer} testID="review-photo-viewer">
          <View style={[styles.viewerHeader, { paddingTop: insets.top + spacing.sm }]}>
            <Text style={styles.viewerCounter} testID="review-photo-viewer-counter">
              {(viewerIndex ?? 0) + 1} / {resolved.length}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close photo viewer"
              onPress={closeViewer}
              hitSlop={8}
              style={styles.closeButton}
            >
              <Ionicons name="close" size={26} color="#FFFFFF" />
            </Pressable>
          </View>

          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            contentOffset={{ x: (viewerIndex ?? 0) * windowWidth, y: 0 }}
          >
            {resolved.map((item) => (
              <View key={item.hash} style={[styles.viewerPage, { width: windowWidth }]}>
                {item.fullUri ? (
                  <Image
                    source={{ uri: item.fullUri }}
                    style={styles.fullImage}
                    contentFit="contain"
                    accessibilityIgnoresInvertColors
                  />
                ) : (
                  <View style={styles.fullPlaceholder}>
                    <Ionicons name="image-outline" size={48} color={colors.textSecondary} />
                    <Text style={styles.placeholderText}>Photo unavailable offline</Text>
                  </View>
                )}
              </View>
            ))}
          </ScrollView>

          {(onReportPhoto || onHidePhoto) && current ? (
            <View style={[styles.viewerActions, { paddingBottom: insets.bottom + spacing.md }]}>
              {onHidePhoto ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Hide this photo"
                  testID="review-photo-hide"
                  onPress={() => {
                    onHidePhoto(current.hash);
                    closeViewer();
                  }}
                  style={styles.actionButton}
                >
                  <Ionicons name="eye-off-outline" size={18} color="#FFFFFF" />
                  <Text style={styles.actionText}>Hide</Text>
                </Pressable>
              ) : null}
              {onReportPhoto ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Report this photo"
                  testID="review-photo-report"
                  onPress={() => {
                    onReportPhoto(current.hash);
                    closeViewer();
                  }}
                  style={styles.actionButton}
                >
                  <Ionicons name="flag-outline" size={18} color="#FFFFFF" />
                  <Text style={styles.actionText}>Report</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>
      </Modal>
    </View>
  );
});

const createStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    strip: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.xs,
      marginTop: spacing.xs,
      minHeight: 64,
    },
    thumbWrap: { borderRadius: 10, overflow: 'hidden' },
    thumb: { width: 64, height: 64, borderRadius: 10 },
    placeholder: {
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.border + '40',
    },
    viewer: { flex: 1, backgroundColor: '#000000' },
    viewerHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.sm,
    },
    viewerCounter: { ...typography.body, color: '#FFFFFF' },
    closeButton: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    viewerPage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    fullImage: { width: '100%', height: '100%' },
    fullPlaceholder: { alignItems: 'center', gap: spacing.sm },
    placeholderText: { ...typography.caption, color: '#B0B0B0' },
    viewerActions: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: spacing.xl,
      paddingTop: spacing.md,
    },
    actionButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingHorizontal: spacing.md,
      minHeight: 44,
    },
    actionText: { ...typography.body, color: '#FFFFFF' },
  });
