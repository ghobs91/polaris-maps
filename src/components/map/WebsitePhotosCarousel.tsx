import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../contexts/ThemeContext';
import {
  WEBSITE_PHOTOS_JS,
  countRealPhotos,
  extractPhotosFromWebViewMessage,
  fetchWebsitePhotos,
  normalizeWebsiteUrl,
  resolveWebViewPhotoUrls,
} from '../../services/poi/websitePhotosService';
import { borderRadius, spacing, typography } from '../../constants/theme';

/**
 * Carousel of photos pulled from the POI's own website via on-device
 * headless browsing.
 *
 * Hybrid strategy: plain-fetch the homepage (plus gallery/photos subpages
 * when needed) first; if that yields no real photos, mount a hidden WebView
 * that loads the real page and extracts targets via injected JS. Gallery
 * images take priority over generic page metadata, and broken images are
 * dropped silently.
 *
 * Renders nothing when the POI has no website or no photos are found —
 * it is a silent enhancement above the MapKit embed.
 */

const WEBVIEW_TIMEOUT_MS = 15000;
const VIEWER_WIDTH = Dimensions.get('window').width;

interface Props {
  websiteUrl: string | null | undefined;
  /** Remount/reset key — pass the POI id so stale photos never linger. */
  resetKey: string | number;
}

export function WebsitePhotosCarousel({ websiteUrl, resetKey }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [photos, setPhotos] = useState<string[]>([]);
  const [needWebView, setNeedWebView] = useState(false);
  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  const settledRef = useRef(false);
  const photosRef = useRef<string[]>([]);
  const viewerListRef = useRef<FlatList<string>>(null);
  const [failedUrls, setFailedUrls] = useState<Set<string>>(new Set());

  const setPhotoList = useCallback((urls: string[]) => {
    photosRef.current = urls;
    setPhotos(urls);
  }, []);

  const pageUrl = useMemo(() => normalizeWebsiteUrl(websiteUrl), [websiteUrl]);

  useEffect(() => {
    settledRef.current = false;
    photosRef.current = [];
    setPhotos([]);
    setFailedUrls(new Set());
    setNeedWebView(false);
    setViewerVisible(false);
    setViewerIndex(0);
    if (!pageUrl) return;
    let cancelled = false;
    fetchWebsitePhotos(pageUrl)
      .then((urls) => {
        if (cancelled || settledRef.current) return;
        if (urls.length > 0) setPhotoList(urls);
        if (countRealPhotos(urls) > 0) {
          // Good enough — skip the headless browser.
          settledRef.current = true;
        } else {
          // Only logos (or nothing): try the on-device browser for better.
          setNeedWebView(true);
        }
      })
      .catch(() => {
        if (!cancelled && !settledRef.current) setNeedWebView(true);
      });
    return () => {
      cancelled = true;
    };
  }, [pageUrl, resetKey, setPhotoList]);

  // Give up on the hidden browser after a timeout — stay hidden silently.
  useEffect(() => {
    if (!needWebView || settledRef.current) return;
    const timer = setTimeout(() => {
      settledRef.current = true;
      setNeedWebView(false);
    }, WEBVIEW_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [needWebView, pageUrl, resetKey]);

  const visiblePhotos = useMemo(
    () => photos.filter((uri) => !failedUrls.has(uri)),
    [photos, failedUrls],
  );

  const handleImageError = useCallback((uri: string) => {
    // Drop images that fail to load (hotlink protection, dead URLs) so no
    // dark/empty tiles linger in the carousel.
    setFailedUrls((prev) => {
      if (prev.has(uri)) return prev;
      const next = new Set(prev);
      next.add(uri);
      return next;
    });
  }, []);

  const openViewer = useCallback((index: number) => {
    setViewerIndex(index);
    setViewerVisible(true);
  }, []);

  const closeViewer = useCallback(() => {
    setViewerVisible(false);
  }, []);

  useEffect(() => {
    if (!viewerVisible) return;
    requestAnimationFrame(() => {
      viewerListRef.current?.scrollToIndex({ index: viewerIndex, animated: false });
    });
  }, [viewerVisible, viewerIndex]);

  if (!pageUrl) return null;

  const hostname = (() => {
    try {
      return new URL(pageUrl).hostname.replace(/^www\./, '');
    } catch {
      return null;
    }
  })();

  return (
    <View style={styles.section} testID="website-photos-section">
      {needWebView && !settledRef.current && (
        <View style={styles.hiddenWebView} pointerEvents="none">
          <WebView
            source={{ uri: pageUrl }}
            style={styles.hiddenWebView}
            injectedJavaScript={WEBSITE_PHOTOS_JS}
            javaScriptEnabled
            domStorageEnabled
            mediaPlaybackRequiresUserAction
            setSupportMultipleWindows={false}
            onMessage={(event) => {
              const raw = extractPhotosFromWebViewMessage(event.nativeEvent.data);
              if (!raw || settledRef.current) return;
              const resolved = resolveWebViewPhotoUrls(raw, pageUrl);
              const prev = photosRef.current;
              // Adopt an equally strong browser result too, since its gallery
              // container ordering can be better than plain HTML parsing.
              if (
                resolved.length > 0 &&
                (countRealPhotos(resolved) >= countRealPhotos(prev) || prev.length === 0)
              ) {
                setPhotoList(resolved);
              }
              if (countRealPhotos(photosRef.current) > 0) {
                settledRef.current = true;
                setNeedWebView(false);
              }
            }}
            onError={() => {
              settledRef.current = true;
              setNeedWebView(false);
            }}
            onHttpError={() => {
              settledRef.current = true;
              setNeedWebView(false);
            }}
          />
        </View>
      )}
      {visiblePhotos.length > 0 && (
        <>
          <Text style={[styles.title, { color: colors.text }]}>
            From the web{hostname ? ` · ${hostname}` : ''}
          </Text>
          <FlatList
            data={visiblePhotos}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={(item) => item}
            contentContainerStyle={styles.strip}
            renderItem={({ item }) => (
              <Pressable
                testID={`website-photo-thumbnail-${visiblePhotos.indexOf(item)}`}
                onPress={() => openViewer(visiblePhotos.indexOf(item))}
                accessibilityLabel={`Open photo ${visiblePhotos.indexOf(item) + 1}`}
                accessibilityRole="button"
              >
                <Image
                  source={{ uri: item }}
                  style={[
                    styles.thumb,
                    { borderColor: colors.border, backgroundColor: colors.surface },
                  ]}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  onError={() => handleImageError(item)}
                />
              </Pressable>
            )}
          />
        </>
      )}
      <Modal
        visible={viewerVisible}
        animationType="fade"
        presentationStyle="fullScreen"
        onRequestClose={closeViewer}
      >
        <View
          style={[styles.viewer, { backgroundColor: colors.backgroundDark }]}
          testID="website-photo-viewer"
        >
          <View
            style={[styles.viewerHeader, { paddingTop: insets.top + spacing.sm }]}
            testID="website-photo-viewer-header"
          >
            <Text style={styles.viewerCount} accessibilityLiveRegion="polite">
              {`${viewerIndex + 1} / ${visiblePhotos.length}`}
            </Text>
            <Pressable
              onPress={closeViewer}
              accessibilityLabel="Close photo viewer"
              accessibilityRole="button"
              hitSlop={8}
              style={styles.closeButton}
            >
              <Text style={styles.closeButtonText}>×</Text>
            </Pressable>
          </View>
          <FlatList
            ref={viewerListRef}
            data={visiblePhotos}
            style={styles.viewerList}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            keyExtractor={(item) => `viewer-${item}`}
            initialScrollIndex={viewerIndex}
            getItemLayout={(_, index) => ({
              length: VIEWER_WIDTH,
              offset: VIEWER_WIDTH * index,
              index,
            })}
            onMomentumScrollEnd={(event) => {
              setViewerIndex(Math.round(event.nativeEvent.contentOffset.x / VIEWER_WIDTH));
            }}
            renderItem={({ item }) => (
              <View style={styles.viewerSlide}>
                <Image
                  source={{ uri: item }}
                  style={styles.viewerImage}
                  contentFit="contain"
                  priority="high"
                  cachePolicy="memory-disk"
                  onError={() => handleImageError(item)}
                  accessibilityLabel="Website photo"
                />
              </View>
            )}
          />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  title: {
    ...typography.label,
    marginBottom: spacing.sm,
  },
  strip: {
    gap: spacing.sm,
  },
  thumb: {
    width: 120,
    height: 120,
    borderRadius: borderRadius.md,
    borderWidth: 1,
  },
  hiddenWebView: {
    width: 0,
    height: 0,
    opacity: 0,
  },
  viewer: {
    flex: 1,
  },
  viewerHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
  },
  viewerCount: {
    color: '#FFFFFF',
    ...typography.label,
  },
  closeButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderRadius: borderRadius.round,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  closeButtonText: {
    color: '#FFFFFF',
    fontSize: 30,
    fontWeight: '300',
    lineHeight: 34,
  },
  viewerSlide: {
    alignItems: 'center',
    height: '100%',
    justifyContent: 'center',
    width: VIEWER_WIDTH,
  },
  viewerList: {
    flex: 1,
  },
  viewerImage: {
    height: '100%',
    width: '100%',
  },
});
