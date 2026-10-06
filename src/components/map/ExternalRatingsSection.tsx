import React, { useCallback, useMemo } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { useTheme } from '../../contexts/ThemeContext';
import { useExternalRatings } from '../../hooks/useExternalRatings';
import { assemblePoiAddress } from '../../services/poi/poiAddress';
import {
  combineExternalRatings,
  type CombinedRating,
} from '../../services/poi/externalRatings/combine';
import type { OsmPoi } from '../../services/poi/osmFetcher';
import type {
  ExternalRatingProviderId,
  ExternalRatingQuery,
  ExternalRatingSummary,
} from '../../services/poi/externalRatings/types';
import { borderRadius, spacing, typography } from '../../constants/theme';

/**
 * External aggregate ratings from TripAdvisor and Yelp, resolved via the
 * on-device headless browser. When both providers have a rating they are
 * combined into one count-weighted aggregate; the individual provider listings
 * are surfaced as clickable pills. No review text is fetched or displayed, and
 * nothing is persisted.
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

  const { states, handleMessage, handleError } = useExternalRatings(query, poi.id);

  // Serialize hidden browsing: mount at most one provider WebView at a time, in
  // registry order. A waiting provider's stage is picked up once this one settles.
  const activeWebView = states.find((s) => s.webView)?.webView ?? null;
  const loaded = states
    .filter((s) => s.status === 'loaded' && s.summary)
    .map((s) => s.summary as ExternalRatingSummary);
  const combined = combineExternalRatings(loaded);

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

      {combined ? (
        <CombinedRatingBlock combined={combined} sources={loaded} colors={colors} />
      ) : null}
    </View>
  );
}

function CombinedRatingBlock({
  combined,
  sources,
  colors,
}: {
  combined: CombinedRating;
  sources: ExternalRatingSummary[];
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  const openListing = useCallback((url: string) => {
    Linking.openURL(url).catch(() => {});
  }, []);

  return (
    <View style={styles.section} testID="external-ratings-combined">
      <View style={[styles.row, { borderBottomColor: colors.border }]}>
        <Text
          style={[styles.rating, { color: colors.text }]}
          testID="external-ratings-combined-rating"
        >
          {combined.rating.toFixed(1)}
        </Text>
        <Text style={[styles.stars, { color: colors.warning }]}>
          {renderStars(combined.rating)}
        </Text>
        <Text
          style={[styles.count, { color: colors.textSecondary }]}
          testID="external-ratings-combined-count"
        >
          {combined.reviewCount.toLocaleString()} reviews
        </Text>
      </View>

      <View style={styles.pills}>
        {sources.map((summary) => {
          const label = PROVIDER_LABEL[summary.provider];
          return (
            <Pressable
              key={summary.provider}
              onPress={() => openListing(summary.listingUrl)}
              accessibilityRole="link"
              accessibilityLabel={`Open ${label} listing`}
              hitSlop={6}
              style={({ pressed }) => [
                styles.pill,
                { borderColor: colors.border, opacity: pressed ? 0.6 : 1 },
              ]}
              testID={`external-ratings-pill-${summary.provider}`}
            >
              <Text style={[styles.pillText, { color: colors.primary }]}>{label}</Text>
            </Pressable>
          );
        })}
        <Text style={[styles.observed, { color: colors.textSecondary }]}>
          Observed {formatObserved(combined.observedAt)}
        </Text>
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
  rating: {
    ...typography.h3,
    fontSize: 20,
  },
  stars: {
    ...typography.label,
    fontSize: 13,
    letterSpacing: 1,
    marginLeft: spacing.xs,
  },
  count: {
    ...typography.bodySmall,
    marginLeft: spacing.sm,
  },
  pills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  pill: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.round,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
  },
  pillText: {
    ...typography.label,
    fontSize: 13,
    fontWeight: '600',
  },
  observed: {
    ...typography.caption,
    marginLeft: 'auto',
  },
});
