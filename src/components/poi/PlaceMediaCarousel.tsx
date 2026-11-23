import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { spacing, typography, borderRadius } from '../../constants/theme';
import { useTheme } from '../../contexts/ThemeContext';
import { GlassView } from '../common/GlassView';
import { useThemedStyles, type Theme } from '../../hooks/useThemedStyles';
import { getConnectivity } from '../../services/regions/connectivityService';
import {
  canonicalPlaceKey,
  getPlaceDetail,
  putPlaceDetail,
} from '../../services/places/placeDetailCache';
import {
  collectPlaceMedia,
  type PlaceMediaItem,
  type PlaceMediaProvider,
} from '../../services/poi/placeMediaService';
import { defaultPlaceMediaSupplements } from '../../services/poi/placeMediaProviders';
import {
  fetchWebsitePhotosResult,
  normalizeWebsiteUrl,
} from '../../services/poi/websitePhotosService';

interface PlaceMediaCarouselProps {
  lat: number;
  lng: number;
  name?: string;
  osmId?: string;
  /** POI homepage; its photos are merged into the same carousel. */
  websiteUrl?: string | null;
  tags: Record<string, string>;
  /** Remount/reset key — pass the POI id so stale media never lingers. */
  resetKey: string | number;
  /** Reactive connectivity; a reconnect re-fetches open media. */
  online?: boolean;
  /**
   * False while the place card is still opening. The carousel renders nothing
   * (it is not yet populated) and starts no scrape or hidden WebView, which is
   * what used to stall the card's sheet animation.
   */
  enabled?: boolean;
  /**
   * Fired once per load with the URL the venue website finally resolved to
   * (post-redirect), or null when it wasn't reachable. Lets the place card
   * reconcile an out-of-date website tag with the site's new home.
   */
  onWebsiteResolved?: (finalUrl: string | null) => void;
}

/**
 * How many photos the strip keeps.
 *
 * Bounded on purpose: every item is a remote image decode, and the strip used
 * to grow to whatever the scrape returned. Eight is more than fits on screen.
 */
const MAX_STRIP_PHOTOS = 8;

/**
 * Open-licensed place media (Wikimedia Commons, Panoramax) supplementing the
 * primary website scraper. Every open-source item renders visible attribution
 * and a license link. Offline, cached metadata is served and thumbnails fall
 * back to a deliberate placeholder instead of a broken image.
 */
export function PlaceMediaCarousel({
  lat,
  lng,
  name,
  osmId,
  websiteUrl,
  tags,
  resetKey,
  online,
  enabled = true,
  onWebsiteResolved,
}: PlaceMediaCarouselProps) {
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [items, setItems] = useState<PlaceMediaItem[]>([]);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const [offline, setOffline] = useState(false);
  // Kept in a ref so an unstable parent callback can't re-run the fetch effect.
  const onWebsiteResolvedRef = useRef(onWebsiteResolved);
  onWebsiteResolvedRef.current = onWebsiteResolved;

  const cacheKey = useMemo(
    () => ({
      placeId: tags['polaris:place_uuid'] ?? null,
      osmId: osmId ?? null,
      lat,
      lng,
      name,
    }),
    [tags, osmId, lat, lng, name],
  );

  const pageUrl = useMemo(
    () => (websiteUrl ? normalizeWebsiteUrl(websiteUrl) : null),
    [websiteUrl],
  );

  const webAttribution = useMemo(() => {
    if (!pageUrl) return undefined;
    try {
      const host = new URL(pageUrl).hostname.replace(/^www\./, '');
      return host ? `From the web · ${host}` : 'From the web';
    } catch {
      return 'From the web';
    }
  }, [pageUrl]);

  const persistMedia = useCallback(
    async (media: PlaceMediaItem[]) => {
      if (media.length === 0) return;
      // Persist attribution metadata (not bytes) for the offline path.
      const existing = await getPlaceDetail(cacheKey).catch(() => null);
      await putPlaceDetail({
        canonicalId: canonicalPlaceKey(cacheKey),
        placeId: cacheKey.placeId,
        osmId: cacheKey.osmId,
        name: name ?? '',
        lat,
        lng,
        snapshot: existing?.snapshot ?? '',
        media: JSON.stringify(media),
        reviews: existing?.reviews ?? null,
        sourceVersion: existing?.sourceVersion ?? 1,
      }).catch(() => undefined);
    },
    [cacheKey, lat, lng, name],
  );

  useEffect(() => {
    let cancelled = false;
    setItems([]);
    setFailed(new Set());
    setViewerIndex(null);

    // Hold every scrape back until the card has finished opening; the fetch and
    // HTML parse run on the JS thread and visibly froze the sheet's spring
    // animation.
    if (!enabled) {
      return () => {
        cancelled = true;
      };
    }

    const connected = online ?? getConnectivity().isConnected;
    setOffline(!connected);

    if (!connected) {
      getPlaceDetail(cacheKey)
        .then((row) => {
          if (cancelled || !row?.media) return;
          try {
            setItems(JSON.parse(row.media) as PlaceMediaItem[]);
          } catch {
            setItems([]);
          }
        })
        .catch(() => setItems([]));
      return () => {
        cancelled = true;
      };
    }

    const query = { lat, lng, name, tags };
    // Filled by the website provider below once the fetch settles.
    let resolvedFinalUrl: string | null = null;
    const websiteProvider: PlaceMediaProvider | undefined = pageUrl
      ? {
          id: 'website',
          async fetch() {
            const result = await fetchWebsitePhotosResult(pageUrl);
            resolvedFinalUrl = result.finalUrl;
            return result.urls.map((url) => ({
              url,
              source: 'website',
              thumbnailUrl: url,
              attribution: webAttribution,
            }));
          },
        }
      : undefined;
    collectPlaceMedia(query, {
      websiteProvider,
      supplements: defaultPlaceMediaSupplements(),
    })
      .then(async (media) => {
        if (cancelled) return;
        setItems(media);
        void persistMedia(media);
        onWebsiteResolvedRef.current?.(resolvedFinalUrl);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });

    return () => {
      cancelled = true;
    };
  }, [
    enabled,
    cacheKey,
    lat,
    lng,
    name,
    tags,
    resetKey,
    online,
    pageUrl,
    webAttribution,
    persistMedia,
  ]);

  const visible = useMemo(
    () => items.filter((item) => !failed.has(item.url)).slice(0, MAX_STRIP_PHOTOS),
    [items, failed],
  );
  const current = viewerIndex !== null ? visible[viewerIndex] : undefined;

  const handleError = useCallback((url: string) => {
    setFailed((prev) => {
      if (prev.has(url)) return prev;
      const next = new Set(prev);
      next.add(url);
      return next;
    });
  }, []);

  const openLicense = useCallback((url?: string) => {
    if (url) void Linking.openURL(url).catch(() => undefined);
  }, []);

  const closeViewer = useCallback(() => setViewerIndex(null), []);

  if (items.length === 0) {
    if (!offline) return null;
    return (
      <>
        <GlassView
          material="regular"
          style={[styles.section, { borderColor: colors.border }]}
          testID="place-media-empty"
        >
          <View style={styles.titleRow}>
            <Ionicons name="images-outline" size={16} color={colors.textSecondary} />
            <Text style={styles.title}>Photos</Text>
          </View>
          <View style={[styles.emptyState, { borderColor: colors.border }]}>
            <Ionicons name="cloud-offline-outline" size={18} color={colors.textSecondary} />
            <Text style={styles.emptyText}>Photos are unavailable offline</Text>
          </View>
        </GlassView>
      </>
    );
  }

  return (
    <GlassView
      material="regular"
      style={[styles.section, { borderColor: colors.border }]}
      testID="place-media-section"
    >
      <View style={styles.titleRow}>
        <Ionicons name="images-outline" size={16} color={colors.textSecondary} />
        <Text style={styles.title}>Photos</Text>
      </View>
      <FlatList
        data={visible}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item.url}
        contentContainerStyle={styles.strip}
        testID="place-media-strip"
        removeClippedSubviews
        windowSize={3}
        renderItem={({ item, index }) => {
          const caption = item.attribution ?? item.source;
          return (
            <Pressable
              testID={`place-media-thumb-${index}`}
              accessibilityRole="button"
              accessibilityLabel={`Open photo ${index + 1}, ${caption}`}
              onPress={() => setViewerIndex(index)}
              style={styles.thumbWrap}
            >
              {item.thumbnailUrl ? (
                <Image
                  source={{ uri: item.thumbnailUrl }}
                  style={[styles.thumb, { borderColor: colors.border }]}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  recyclingKey={item.url}
                  transition={120}
                  onError={() => handleError(item.url)}
                  accessibilityIgnoresInvertColors
                />
              ) : (
                <View
                  style={[styles.thumb, styles.thumbPlaceholder, { borderColor: colors.border }]}
                >
                  <Ionicons name="image-outline" size={20} color={colors.textSecondary} />
                </View>
              )}
            </Pressable>
          );
        }}
      />

      <Modal
        visible={current != null}
        transparent
        animationType="fade"
        onRequestClose={closeViewer}
      >
        {current ? (
          <View style={styles.viewer} testID="place-media-viewer">
            <View style={[styles.viewerHeader, { paddingTop: insets.top + spacing.sm }]}>
              <Text style={styles.viewerCount} testID="place-media-viewer-counter">
                {visible.length > 0 ? (viewerIndex ?? 0) + 1 : 0} / {visible.length}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close photo viewer"
                onPress={closeViewer}
                hitSlop={8}
                style={styles.closeButton}
                testID="place-media-viewer-close"
              >
                <Ionicons name="close" size={26} color="#FFFFFF" />
              </Pressable>
            </View>

            <FlatList
              data={visible}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              keyExtractor={(item) => item.url}
              style={styles.viewerList}
              testID="place-media-viewer-pager"
              initialScrollIndex={viewerIndex ?? 0}
              getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
              onMomentumScrollEnd={(e) => {
                // Ignore late momentum events once the viewer is closing.
                if (viewerIndex === null) return;
                const next = Math.round(e.nativeEvent.contentOffset.x / width);
                if (Number.isFinite(next) && next !== viewerIndex) setViewerIndex(next);
              }}
              renderItem={({ item }) => (
                <View style={[styles.viewerPage, { width }]}>
                  {item.url ? (
                    <Image
                      source={{ uri: item.url }}
                      style={styles.viewerImage}
                      contentFit="contain"
                      onError={() => handleError(item.url)}
                      accessibilityIgnoresInvertColors
                    />
                  ) : (
                    <Ionicons name="image-outline" size={48} color={colors.textSecondary} />
                  )}
                </View>
              )}
            />

            <View style={[styles.viewerFooter, { paddingBottom: insets.bottom + spacing.md }]}>
              <Text style={styles.viewerAttribution} numberOfLines={2}>
                {current.attribution ?? current.source}
                {current.license ? ` · ${current.license}` : ''}
              </Text>
              {current.licenseUrl ? (
                <Pressable
                  accessibilityRole="link"
                  accessibilityLabel="View photo license"
                  testID="place-media-license-link"
                  onPress={() => openLicense(current.licenseUrl)}
                  style={styles.licenseLink}
                >
                  <Ionicons name="open-outline" size={14} color="#FFFFFF" />
                  <Text style={styles.licenseLinkText}>View license</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}
      </Modal>
    </GlassView>
  );
}

const createStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    section: {
      marginHorizontal: spacing.md,
      marginBottom: spacing.md,
      borderRadius: borderRadius.lg,
      borderCurve: 'continuous',
      overflow: 'hidden',
      padding: spacing.md,
    },
    title: { ...typography.label, color: colors.text },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginBottom: spacing.sm,
    },
    strip: { gap: spacing.sm },
    thumbWrap: { width: 120 },
    thumb: {
      width: 120,
      height: 120,
      borderRadius: 12,
      borderWidth: 1,
      backgroundColor: colors.surface,
    },
    thumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
    emptyState: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: 12,
      padding: spacing.md,
    },
    emptyText: { ...typography.caption, color: colors.textSecondary, flex: 1 },
    viewer: { flex: 1, backgroundColor: '#000000' },
    viewerHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.sm,
    },
    viewerCount: { ...typography.body, color: '#FFFFFF' },
    closeButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    viewerList: { flex: 1 },
    viewerPage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    viewerImage: { width: '100%', height: '100%' },
    viewerFooter: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.xs },
    viewerAttribution: { ...typography.caption, color: '#E0E0E0' },
    licenseLink: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44 },
    licenseLinkText: { ...typography.caption, color: '#FFFFFF', textDecorationLine: 'underline' },
  });
