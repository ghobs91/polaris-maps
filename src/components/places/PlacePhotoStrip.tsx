import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useTheme } from '../../contexts/ThemeContext';
import { getConnectivity } from '../../services/regions/connectivityService';
import { fetchWebsitePhotos, normalizeWebsiteUrl } from '../../services/poi/websitePhotosService';
import {
  getCachedPlacePhotos,
  setCachedPlacePhotos,
  MAX_PLACE_PHOTOS,
} from '../../services/places/placePhotoCache';
import { spacing } from '../../constants/theme';

interface PlacePhotoStripProps {
  websiteUrl?: string | null;
  /** Remount/reset key — pass the saved-place id so stale photos never linger. */
  resetKey: string | number;
}

const PHOTO_WIDTH = 148;
const PHOTO_HEIGHT = 110;

/**
 * Cap concurrent website scrapes. A long list mounts many rows at once; without
 * this every visible row would hit the network simultaneously.
 */
const MAX_CONCURRENT_FETCHES = 3;
let activeFetches = 0;
const fetchWaiters: Array<() => void> = [];

function acquireFetchSlot(): Promise<void> {
  if (activeFetches < MAX_CONCURRENT_FETCHES) {
    activeFetches++;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    fetchWaiters.push(() => {
      activeFetches++;
      resolve();
    });
  });
}

function releaseFetchSlot(): void {
  activeFetches = Math.max(0, activeFetches - 1);
  const next = fetchWaiters.shift();
  if (next) next();
}

/**
 * Horizontally scrolling strip of a place's website photos, Google Maps style.
 *
 * The resolved photo URLs are persisted to disk (see `placePhotoCache`) and the
 * image bytes are cached by expo-image, so reopening a long list renders
 * instantly instead of re-scraping every venue website.
 */
export function PlacePhotoStrip({ websiteUrl, resetKey }: PlacePhotoStripProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [urls, setUrls] = useState<string[]>([]);

  const pageUrl = useMemo(
    () => (websiteUrl ? normalizeWebsiteUrl(websiteUrl) : null),
    [websiteUrl],
  );

  useEffect(() => {
    let cancelled = false;
    setUrls([]);
    if (!pageUrl) return undefined;

    const cached = getCachedPlacePhotos(pageUrl);
    if (cached) {
      setUrls(cached);
      return undefined;
    }

    if (!getConnectivity().isConnected) return undefined;

    (async () => {
      await acquireFetchSlot();
      try {
        const found = await fetchWebsitePhotos(pageUrl);
        if (cancelled) return;
        const capped = found.slice(0, MAX_PLACE_PHOTOS);
        setUrls(capped);
        // Cache the result even when empty (negative cache) so a site with no
        // discoverable photos isn't re-scraped on every list open.
        setCachedPlacePhotos(pageUrl, capped);
      } catch {
        // Scraping is best-effort — leave the strip hidden.
      } finally {
        releaseFetchSlot();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pageUrl, resetKey]);

  if (!pageUrl || urls.length === 0) return null;

  return (
    <FlatList
      data={urls}
      horizontal
      showsHorizontalScrollIndicator={false}
      keyExtractor={(url) => url}
      contentContainerStyle={styles.strip}
      testID="place-photo-strip"
      renderItem={({ item }) => (
        <Image
          source={{ uri: item }}
          style={styles.photo}
          contentFit="cover"
          cachePolicy="memory-disk"
          recyclingKey={item}
          accessibilityIgnoresInvertColors
        />
      )}
    />
  );
}

const createStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    strip: {
      gap: spacing.sm,
      paddingRight: spacing.sm,
    },
    photo: {
      width: PHOTO_WIDTH,
      height: PHOTO_HEIGHT,
      borderRadius: 14,
      borderCurve: 'continuous',
      backgroundColor: colors.surface,
    },
  });
