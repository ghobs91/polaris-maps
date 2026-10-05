import React, { useCallback, useMemo } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { useTheme } from '../../contexts/ThemeContext';
import { useExternalRatings } from '../../hooks/useExternalRatings';
import { assemblePoiAddress } from '../../services/poi/poiAddress';
import type { OsmPoi } from '../../services/poi/osmFetcher';
import type {
  ExternalRatingProviderId,
  ExternalRatingQuery,
  ExternalRatingSummary,
} from '../../services/poi/externalRatings/types';
import { borderRadius, spacing, typography } from '../../constants/theme';

/**
 * External aggregate ratings from TripAdvisor and Yelp, resolved via the
 * on-device headless browser. Each provider is shown independently, only with
 * attribution (provider, rating, exact count, observed time, source link). No
 * review text is fetched or displayed, and nothing is persisted.
 *
 * Bounded policy: only one hidden WebView is mounted at a time; the WebView uses
 * the native user agent with a persistent (non-incognito) cookie store. The app
 * behaves like a single user and gives up silently when challenged — no CAPTCHA
 * solving, proxy/IP rotation, fingerprint spoofing, or auth-wall bypass.
 */

const PROVIDER_LABEL: Record<ExternalRatingProviderId, string> = {
  tripadvisor: 'Tripadvisor',
  yelp: 'Yelp',
};

export function ExternalRatingsSection({
  poi,
  enrichedFormattedAddress,
}: {
  poi: OsmPoi;
  enrichedFormattedAddress?: string | null;
}) {
  const { colors } = useTheme();

  const query = useMemo<ExternalRatingQuery>(
    () => ({
      name: poi.name,
      lat: poi.lat,
      lng: poi.lng,
      address: assemblePoiAddress(poi.tags, enrichedFormattedAddress ?? null),
      website: poi.tags['website'] ?? poi.tags['contact:website'] ?? poi.tags['url'] ?? null,
      tags: poi.tags,
    }),
    [poi, enrichedFormattedAddress],
  );

  const { states, handleMessage, handleError } = useExternalRatings(query);

  // Serialize hidden browsing: mount at most one provider WebView at a time, in
  // registry order. A waiting provider's stage is picked up once this one settles.
  const activeWebView = states.find((s) => s.webView)?.webView ?? null;
  const rows = states.filter((s) => s.status === 'loaded' && s.summary);

  const handleMessageEvent = useCallback(
    (provider: ExternalRatingProviderId) => (event: { nativeEvent: { data: string } }) => {
      handleMessage(provider, event.nativeEvent.data);
    },
    [handleMessage],
  );

  return (
    <View testID="external-ratings-section">
      {activeWebView ? (
        <View style={styles.hiddenWebView} pointerEvents="none">
          <WebView
            key={activeWebView.provider}
            source={{ uri: activeWebView.uri }}
            style={styles.hiddenWebView}
            injectedJavaScript={activeWebView.injectedJavaScript}
            javaScriptEnabled
            domStorageEnabled
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
            mediaPlaybackRequiresUserAction
            setSupportMultipleWindows={false}
            onMessage={handleMessageEvent(activeWebView.provider)}
            onError={() => handleError(activeWebView.provider)}
            onHttpError={() => handleError(activeWebView.provider)}
          />
        </View>
      ) : null}

      {rows.map((state) => (
        <RatingRow
          key={state.provider}
          summary={state.summary as ExternalRatingSummary}
          colors={colors}
        />
      ))}
    </View>
  );
}

function RatingRow({
  summary,
  colors,
}: {
  summary: ExternalRatingSummary;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  const label = PROVIDER_LABEL[summary.provider];
  const openListing = useCallback(() => {
    Linking.openURL(summary.listingUrl).catch(() => {});
  }, [summary.listingUrl]);

  const stars = renderStars(summary.rating);

  return (
    <View style={styles.section} testID={`external-rating-section-${summary.provider}`}>
      <View style={[styles.row, { borderBottomColor: colors.border }]}>
        <View style={styles.badge}>
          <Text style={[styles.badgeText, { color: colors.text }]}>{label}</Text>
        </View>
        <View style={styles.metrics}>
          <Text
            style={[styles.rating, { color: colors.text }]}
            testID={`external-rating-${summary.provider}`}
          >
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
          accessibilityLabel={`Open listing on ${label}`}
          accessibilityRole="button"
          hitSlop={8}
        >
          <Text style={[styles.link, { color: colors.primary }]}>{`View on ${label}`}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function renderStars(rating: number): string {
  const full = Math.round(rating);
  const clamped = Math.max(0, Math.min(5, full));
  return '★'.repeat(clamped) + '☆'.repeat(5 - clamped);
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
  hiddenWebView: {
    width: 0,
    height: 0,
    opacity: 0,
  },
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
});
