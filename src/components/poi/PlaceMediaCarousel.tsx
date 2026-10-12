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
import { fetchWebsitePhotos, normalizeWebsiteUrl } from '../../services/poi/websitePhotosService';
import { WebsitePhotosWebView } from './WebsitePhotosWebView';

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
}

/** Below this many scraped website photos, also try the hidden WebView fallback. */
const WEBVIEW_FALLBACK_MIN_WEBSITE_PHOTOS = 3;

/** Merge `incoming` ahead of `prev`, de-duplicated by URL. */
function prependUniquePhotos(prev: PlaceMediaItem[], incoming: PlaceMediaItem[]): PlaceMediaItem[] {
  const seen = new Set<string>();
  const out: PlaceMediaItem[] = [];
  for (const item of [...incoming, ...prev]) {
    if (!item.url || seen.has(item.url)) continue;
    seen.add(item.url);
    out.push(item);
  }
  return out;
}

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
}: PlaceMediaCarouselProps) {
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [items, setItems] = useState<PlaceMediaItem[]>([]);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const [offline, setOffline] = useState(false);
  /** Venue page to render in the hidden WebView when the plain scrape is thin. */
  const [webViewUri, setWebViewUri] = useState<string | null>(null);
  const itemsRef = useRef<PlaceMediaItem[]>([]);
  itemsRef.current = items;

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
    setWebViewUri(null);

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
    const websiteProvider: PlaceMediaProvider | undefined = pageUrl
      ? {
          id: 'website',
          async fetch() {
            const urls = await fetchWebsitePhotos(pageUrl);
            return urls.map((url) => ({
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
        // If the plain scrape found few website photos, render the page in a
        // hidden WebView so JavaScript-built galleries can be extracted too.
        const websitePhotos = media.filter((item) => item.source === 'website').length;
        if (pageUrl && websitePhotos < WEBVIEW_FALLBACK_MIN_WEBSITE_PHOTOS) {
          setWebViewUri(pageUrl);
        }
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, lat, lng, name, tags, resetKey, online, pageUrl, webAttribution, persistMedia]);

  const visible = useMemo(() => items.filter((item) => !failed.has(item.url)), [items, failed]);
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

  const handleWebViewPhotos = useCallback(
    (urls: string[]) => {
      if (urls.length === 0) return;
      const websiteItems: PlaceMediaItem[] = urls.map((url) => ({
        url,
        source: 'website',
        thumbnailUrl: url,
        attribution: webAttribution,
      }));
      setItems((prev) => prependUniquePhotos(prev, websiteItems));
    },
    [webAttribution],
  );

  const handleWebViewSettled = useCallback(() => {
    setWebViewUri(null);
    // Fold any WebView-discovered photos into the offline cache too.
    void persistMedia(itemsRef.current);
  }, [persistMedia]);

  const hiddenWebView = webViewUri ? (
    <WebsitePhotosWebView
      key={`webview:${resetKey}:${webViewUri}`}
      uri={webViewUri}
      onPhotos={handleWebViewPhotos}
      onSettled={handleWebViewSettled}
    />
  ) : null;

  if (items.length === 0) {
    if (!offline) return hiddenWebView;
    return (
      <>
        {hiddenWebView}
        <GlassView
          material="regular"
          style={[styles.section, { borderColor: colors.border }]}
          testID="place-media-empty"
        >
          <Text style={styles.title}>Photos</Text>
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
      {hiddenWebView}
      <Text style={styles.title}>Photos</Text>
      <FlatList
        data={visible}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item.url}
        contentContainerStyle={styles.strip}
        testID="place-media-strip"
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
    title: { ...typography.label, color: colors.text, marginBottom: spacing.sm },
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
