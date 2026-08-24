import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { useTheme } from '../../contexts/ThemeContext';
import { buildPlaceDetailUrl } from '../../services/poi/placeDetailEmbed';
import { isMapSelectionPoi } from '../../services/poi/mapSelectionPoi';
import { mapkitJsEmbedToken, mapkitPlaceDetailUrl } from '../../constants/config';
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
 *
 * Failures are rendered as a muted diagnostic line inside the section (rather
 * than hiding it) so release/TestFlight builds expose WHY the embed failed:
 * missing build config, page-reported errors, native WebView errors, and the
 * page's own step log.
 */

/** Placeholder height shown while the page loads and measures itself. */
const LOADING_HEIGHT = 180;
/** Hard ceiling for the embed — Apple's card limits its own content. */
const MAX_HEIGHT = 720;
const MIN_HEIGHT = 60;

/** How many page step-log messages to keep for diagnostics. */
const MAX_PAGE_LOG_LINES = 6;

interface Props {
  poi: OsmPoi;
  /** Called once when the embed page reports its content height (loaded successfully). */
  onLoaded?: () => void;
  /** Called when the embed fails (page error, HTTP error, or timeout). */
  onFailed?: () => void;
}

export function PlaceDetailEmbed({ poi, onLoaded, onFailed }: Props) {
  const { isDark, colors } = useTheme();
  const theme = isDark ? 'dark' : 'light';

  const url = useMemo(
    () => buildPlaceDetailUrl(poi, theme),
    [poi.id, poi.name, poi.lat, poi.lng, poi.tags, theme],
  );

  const [height, setHeight] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [failureReason, setFailureReason] = useState<string | null>(null);
  const [pageLog, setPageLog] = useState<string[]>([]);
  const notifiedLoadedRef = useRef(false);

  // Keep the latest callbacks in refs so the stable `fail` callback below never
  // triggers effect churn when the parent passes fresh inline functions.
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;
  const onFailedRef = useRef(onFailed);
  onFailedRef.current = onFailed;

  const fail = useCallback((reason: string) => {
    setFailureReason(reason);
    setFailed(true);
    onFailedRef.current?.();
  }, []);

  // Reset state when a different POI is selected.
  useEffect(() => {
    setHeight(null);
    setFailed(false);
    setFailureReason(null);
    setPageLog([]);
    notifiedLoadedRef.current = false;
  }, [poi.id, url]);

  // Client-side watchdog: if the page never reports a height, stop spinning.
  useEffect(() => {
    if (!url || failed || height !== null) return;
    const timer = setTimeout(() => {
      if (__DEV__) {
        console.warn('[PlaceDetailEmbed] timed out waiting for page; hiding section');
      }
      fail('Timed out waiting for the embed page to report its content height');
    }, 30000);
    return () => clearTimeout(timer);
  }, [url, failed, height, fail]);

  const showPlaceholder = height === null && !failed;

  // Transient map-selection pins have no Apple identity — hide the section.
  if (isMapSelectionPoi(poi)) return null;

  // The hosted page or token is missing from this build's config. Render the
  // reason (including WHICH value is missing) instead of hiding the section so
  // misconfigured builds are obvious.
  if (!url) {
    const missing: string[] = [];
    if (!mapkitPlaceDetailUrl) missing.push('hosted page URL');
    if (!mapkitJsEmbedToken) missing.push('MapKit JS token');
    const reason =
      missing.length > 0
        ? `embed not configured in this build (missing ${missing.join(' and ')})`
        : 'embed not configured in this build';
    return (
      <View style={styles.section} testID="place-detail-section">
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Photos & Reviews</Text>
        <Text
          style={[styles.diagText, { color: colors.textSecondary }]}
          testID="place-detail-error"
        >
          {`Unavailable: ${reason}.`}
        </Text>
      </View>
    );
  }

  if (failed) {
    return (
      <View style={styles.section} testID="place-detail-section">
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Photos & Reviews</Text>
        <Text
          style={[styles.diagText, { color: colors.textSecondary }]}
          testID="place-detail-error"
        >
          {`Unavailable: ${failureReason ?? 'unknown error'}`}
        </Text>
        {pageLog.length > 0 && (
          <Text style={[styles.diagLog, { color: colors.textSecondary }]} testID="place-detail-log">
            {pageLog.join('\n')}
          </Text>
        )}
      </View>
    );
  }

  const clampedHeight = height
    ? Math.min(Math.max(height, MIN_HEIGHT), MAX_HEIGHT)
    : LOADING_HEIGHT;

  return (
    <View style={styles.section} testID="place-detail-section">
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
                if (!notifiedLoadedRef.current) {
                  notifiedLoadedRef.current = true;
                  onLoadedRef.current?.();
                }
              } else if (msg.type === 'error') {
                fail(msg.message || 'The embed page reported an error');
              } else if (msg.type === 'log' && typeof msg.message === 'string') {
                setPageLog((prev) => [
                  ...prev.slice(-(MAX_PAGE_LOG_LINES - 1)),
                  msg.message as string,
                ]);
              }
            } catch {
              // Ignore malformed messages from the page.
            }
          }}
          onError={(event) => {
            const { domain, code, description } = event.nativeEvent;
            fail(
              `WebView error ${String(domain ?? '')}/${String(code ?? '')}: ${description ?? ''}`,
            );
          }}
          onHttpError={(event) => {
            const { statusCode, description } = event.nativeEvent;
            fail(`HTTP ${statusCode}: ${description ?? ''}`);
          }}
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
  diagText: {
    fontSize: 12,
    lineHeight: 16,
  },
  diagLog: {
    marginTop: spacing.xs,
    fontSize: 10,
    lineHeight: 14,
    opacity: 0.75,
  },
});
