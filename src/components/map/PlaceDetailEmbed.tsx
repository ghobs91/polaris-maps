import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { useTheme } from '../../contexts/ThemeContext';
import { buildPlaceDetailUrl } from '../../services/poi/placeDetailEmbed';
import { isMapSelectionPoi } from '../../services/poi/mapSelectionPoi';
import type { OsmPoi } from '../../services/poi/osmFetcher';
import { borderRadius, spacing, typography } from '../../constants/theme';

/**
 * Inline "Photos & Reviews" section for the POI card.
 *
 * Embeds Apple's MapKit JS `PlaceDetail` widget (photos, ratings, review
 * snippets — the content Polaris can't source itself) into a transparent,
 * non-scrolling WebView sized to the card's intrinsic height, which the
 * hosted page reports via `postMessage`.
 *
 * The section silently disappears when the embed is not configured, when the
 * selected POI has no Apple lookup key, or when the page fails to load.
 */

/** Placeholder height shown while the page loads and measures itself. */
const LOADING_HEIGHT = 180;
/** Hard ceiling for the embed — Apple's card limits its own content. */
const MAX_HEIGHT = 720;
const MIN_HEIGHT = 60;

interface Props {
  poi: OsmPoi;
}

export function PlaceDetailEmbed({ poi }: Props) {
  const { isDark, colors } = useTheme();
  const theme = isDark ? 'dark' : 'light';

  const url = useMemo(
    () => buildPlaceDetailUrl(poi, theme),
    [poi.id, poi.name, poi.lat, poi.lng, poi.tags, theme],
  );

  const [height, setHeight] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  // Reset state when a different POI is selected.
  useEffect(() => {
    setHeight(null);
    setFailed(false);
  }, [poi.id, url]);

  // Client-side watchdog: if the page never reports a height, stop spinning.
  useEffect(() => {
    if (!url || failed || height !== null) return;
    const timer = setTimeout(() => {
      if (__DEV__) {
        console.warn('[PlaceDetailEmbed] timed out waiting for page; hiding section');
      }
      setFailed(true);
    }, 30000);
    return () => clearTimeout(timer);
  }, [url, failed, height]);

  const showPlaceholder = height === null && !failed;

  // No hosted page configured, or a transient map-selection pin without an
  // Apple identity — hide the whole section.
  if (!url || isMapSelectionPoi(poi)) return null;
  if (failed) return null;

  const clampedHeight = height
    ? Math.min(Math.max(height, MIN_HEIGHT), MAX_HEIGHT)
    : LOADING_HEIGHT;

  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>Photos & Reviews</Text>
      <View
        style={[
          styles.webviewWrap,
          {
            height: clampedHeight,
            borderRadius: borderRadius.lg,
            overflow: 'hidden',
          },
        ]}
      >
        <WebView
          source={{ uri: url }}
          style={styles.webview}
          scrollEnabled={false}
          bounces={false}
          overScrollMode="never"
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          // Let the page surface show through so the card blends with the
          // app's glass background. (iOS-only prop; Android is transparent by
          // default.)
          opaque={false}
          setSupportMultipleWindows={false}
          domStorageEnabled
          androidLayerType="hardware"
          onMessage={(event) => {
            try {
              const msg = JSON.parse(event.nativeEvent.data) as {
                type?: string;
                height?: number;
                message?: string;
              };
              if (__DEV__) {
                console.log('[PlaceDetailEmbed] message:', JSON.stringify(msg));
              }
              if (msg.type === 'height' && typeof msg.height === 'number') {
                setHeight(msg.height);
              } else if (msg.type === 'error') {
                setFailed(true);
              }
            } catch {
              // Ignore malformed messages from the page.
            }
          }}
          onError={() => setFailed(true)}
          onHttpError={() => setFailed(true)}
        />
        {showPlaceholder && (
          <View style={styles.placeholder} pointerEvents="none">
            <ActivityIndicator size="small" color={colors.textSecondary} />
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  sectionTitle: {
    ...typography.label,
    marginBottom: spacing.sm,
  },
  webviewWrap: {
    borderCurve: 'continuous',
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  placeholder: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
