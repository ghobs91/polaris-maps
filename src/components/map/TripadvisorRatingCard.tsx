import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { useTheme } from '../../contexts/ThemeContext';
import {
  TRIPADVISOR_RATING_JS,
  clearTripadvisorRatingCache,
  extractRatingFromWebViewMessage,
  resolveRatingSource,
  validateExternalRating,
  type ExternalRatingSummary,
} from '../../services/poi/tripadvisorService';
import type { OsmPoi } from '../../services/poi/osmFetcher';
import { borderRadius, spacing, typography } from '../../constants/theme';

const WEBVIEW_TIMEOUT_MS = 20_000;

type LoadStatus = 'idle' | 'loading' | 'loaded' | 'failed';

/**
 * External TripAdvisor rating, surfaced via an on-device headless browse of a
 * direct TripAdvisor listing. Displayed only with attribution: provider name,
 * rating, exact review count, observation time, and a link to the source
 * listing. Never persisted — stays transient and device-local.
 *
 * Renders nothing unless a valid, validated rating is obtained.
 */

export function TripadvisorRatingCard({
  poi,
  resetKey,
}: {
  poi: OsmPoi;
  resetKey: string | number;
}) {
  const { colors } = useTheme();
  const [status, setStatus] = useState<LoadStatus>('idle');
  const [summary, setSummary] = useState<ExternalRatingSummary | null>(null);
  // Latest resolved listing URL, kept in a ref so the message handler always
  // sees the current value regardless of render timing.
  const listingUrlRef = useRef<string | null>(null);
  const settledRef = useRef(false);

  useEffect(() => {
    settledRef.current = false;
    listingUrlRef.current = null;
    setSummary(null);
    setStatus('idle');
    if (!poi) return;
    let cancelled = false;

    resolveRatingSource(poi, { timeoutMs: WEBVIEW_TIMEOUT_MS })
      .then((source) => {
        if (cancelled || settledRef.current) return;
        if (!source) {
          setStatus('failed');
          return;
        }
        listingUrlRef.current = source.listingUrl;
        setStatus('loading');
      })
      .catch(() => {
        if (!cancelled && !settledRef.current) setStatus('failed');
      });

    return () => {
      cancelled = true;
    };
  }, [poi, resetKey]);

  // Give up on the hidden browser after a timeout — stay hidden silently.
  useEffect(() => {
    if (status !== 'loading') return;
    const timer = setTimeout(() => {
      settledRef.current = true;
      setStatus('failed');
    }, WEBVIEW_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [status]);

  const handleMessage = useCallback(
    (data: string) => {
      if (settledRef.current) return;
      const url = listingUrlRef.current;
      if (!url) return;
      const raw = extractRatingFromWebViewMessage(data);
      if (!raw) return;
      const validated = validateExternalRating(raw, url, {
        expectedName: poi?.name,
      });
      if (!validated) {
        settledRef.current = true;
        setStatus('failed');
        return;
      }
      setSummary(validated);
      setStatus('loaded');
      settledRef.current = true;
    },
    [poi],
  );

  // Reset transient state on unmount so a stale rating never lingers.
  useEffect(() => {
    return () => {
      settledRef.current = true;
      clearTripadvisorRatingCache();
    };
  }, []);

  const openListing = useCallback(() => {
    if (summary) Linking.openURL(summary.listingUrl);
  }, [summary]);

  // A listing URL was resolved but extraction hasn't succeeded yet — mount the
  // hidden WebView to pull the rating out of the live listing.
  if (status === 'loading' && listingUrlRef.current) {
    return (
      <View style={styles.hiddenWebView} pointerEvents="none">
        <WebView
          source={{ uri: listingUrlRef.current }}
          style={styles.hiddenWebView}
          injectedJavaScript={TRIPADVISOR_RATING_JS}
          javaScriptEnabled
          domStorageEnabled
          mediaPlaybackRequiresUserAction
          setSupportMultipleWindows={false}
          onMessage={(event) => handleMessage(event.nativeEvent.data)}
          onError={() => {
            if (!settledRef.current) {
              settledRef.current = true;
              setStatus('failed');
            }
          }}
          onHttpError={() => {
            if (!settledRef.current) {
              settledRef.current = true;
              setStatus('failed');
            }
          }}
        />
      </View>
    );
  }

  if (status !== 'loaded' || !summary) return null;

  const stars = renderStars(summary.rating);

  return (
    <View style={styles.section} testID="tripadvisor-rating-section">
      <View
        style={[styles.row, { borderBottomColor: colors.border }]}
        testID="tripadvisor-rating-row"
      >
        <View style={styles.badge}>
          <Text style={[styles.badgeText, { color: colors.text }]}>Tripadvisor</Text>
        </View>
        <View style={styles.metrics}>
          <Text style={[styles.rating, { color: colors.text }]} testID="tripadvisor-rating">
            {summary.rating.toFixed(1)}
          </Text>
          <Text style={[styles.stars, { color: colors.warning }]}>{stars}</Text>
          <Text style={[styles.count, { color: colors.textSecondary }]}>
            {summary.reviewCount.toLocaleString()} reviews
          </Text>
        </View>
      </View>
      <View style={styles.footer}>
        <Text style={[styles.observed, { color: colors.textSecondary }]}>
          Observed {formatObserved(summary.observedAt)}
        </Text>
        <Pressable
          onPress={openListing}
          accessibilityLabel="Open listing on Tripadvisor"
          accessibilityRole="button"
          hitSlop={8}
        >
          <Text style={[styles.link, { color: colors.primary }]}>View on Tripadvisor</Text>
        </Pressable>
      </View>
    </View>
  );
}

function renderStars(rating: number): string {
  const full = Math.round(rating);
  return (
    '★'.repeat(Math.max(0, Math.min(5, full))) + '☆'.repeat(5 - Math.max(0, Math.min(5, full)))
  );
}

function formatObserved(observedAt: number): string {
  const diffMs = Date.now() - observedAt;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const styles = StyleSheet.create({
  section: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  badge: {
    borderRadius: borderRadius.sm,
    backgroundColor: 'rgba(28,142,242,0.12)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  badgeText: {
    ...typography.label,
    fontWeight: '600',
  },
  metrics: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginLeft: spacing.md,
  },
  rating: {
    ...typography.h3,
    fontSize: 18,
  },
  stars: {
    ...typography.label,
    fontSize: 13,
    letterSpacing: 1,
  },
  count: {
    ...typography.bodySmall,
    marginLeft: spacing.xs,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  observed: {
    ...typography.caption,
  },
  link: {
    ...typography.label,
    fontSize: 13,
  },
  hiddenWebView: {
    width: 0,
    height: 0,
    opacity: 0,
  },
});
