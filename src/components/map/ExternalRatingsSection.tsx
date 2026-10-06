import React, { useCallback, useMemo } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { GlassView } from '../common/GlassView';
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
 * on-device headless browser, wrapped in a bordered "Reviews" section. When both
 * providers have a rating they are combined into one count-weighted aggregate
 * with the source pills to its right; otherwise the row shows a loading
 * indicator or a write-the-first-review invitation. No review text is fetched or
 * displayed, and nothing is persisted.
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
  onWriteReview,
}: {
  poi: OsmPoi;
  enrichedFormattedAddress?: string | null;
  /** Opens the write-a-review surface when no external rating is found. */
  onWriteReview?: () => void;
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
  // Idle counts as resolving too, so the empty state never flashes before the
  // first resolution pass starts.
  const resolving = states.some(
    (s) => s.status === 'idle' || s.status === 'searching' || s.status === 'loading',
  );

  const handleMessageEvent = useCallback(
    (provider: ExternalRatingProviderId) => (event: { nativeEvent: { data: string } }) => {
      handleMessage(provider, event.nativeEvent.data);
    },
    [handleMessage],
  );

  return (
    <GlassView
      material="regular"
      testID="external-ratings-section"
      style={[styles.section, { borderColor: colors.border }]}
    >
      <Text style={[styles.title, { color: colors.text }]}>Reviews</Text>

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
      ) : resolving ? (
        <LoadingBlock colors={colors} />
      ) : (
        <EmptyBlock colors={colors} onWriteReview={onWriteReview} />
      )}
    </GlassView>
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
    <View style={styles.row} testID="external-ratings-combined">
      <Text
        style={[styles.rating, { color: colors.text }]}
        testID="external-ratings-combined-rating"
      >
        {combined.rating.toFixed(1)}
      </Text>
      <Text style={[styles.stars, { color: colors.warning }]}>{renderStars(combined.rating)}</Text>
      <Text
        style={[styles.count, { color: colors.textSecondary }]}
        testID="external-ratings-combined-count"
      >
        {combined.reviewCount.toLocaleString()} reviews
      </Text>

      {/* Source pills sit to the right of the aggregate. */}
      <View style={styles.pillsInline}>
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
      </View>
    </View>
  );
}

function LoadingBlock({ colors }: { colors: ReturnType<typeof useTheme>['colors'] }) {
  return (
    <View style={styles.statusRow} testID="external-ratings-loading">
      <ActivityIndicator size="small" color={colors.textSecondary} />
      <Text style={[styles.statusText, { color: colors.textSecondary }]}>Loading ratings…</Text>
    </View>
  );
}

function EmptyBlock({
  colors,
  onWriteReview,
}: {
  colors: ReturnType<typeof useTheme>['colors'];
  onWriteReview?: () => void;
}) {
  return (
    <View testID="external-ratings-empty">
      <Pressable
        onPress={onWriteReview}
        disabled={!onWriteReview}
        accessibilityRole="button"
        accessibilityLabel="No ratings yet. Write the first review"
        style={({ pressed }) => [
          styles.writeCta,
          { borderColor: colors.border, opacity: pressed ? 0.6 : 1 },
        ]}
        testID="external-ratings-write-review"
      >
        <MaterialCommunityIcons name="star-outline" size={18} color={colors.primary} />
        <Text style={[styles.writeCtaText, { color: colors.primary }]}>
          No ratings yet — write the first review
        </Text>
      </Pressable>
    </View>
  );
}

function renderStars(rating: number): string {
  const full = Math.round(rating);
  const clamped = Math.max(0, Math.min(5, full));
  return '★'.repeat(clamped) + '☆'.repeat(5 - clamped);
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
    borderRadius: borderRadius.lg,
    borderCurve: 'continuous',
    overflow: 'hidden',
    padding: spacing.md,
  },
  title: {
    ...typography.label,
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    paddingVertical: spacing.xs,
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
  pillsInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginLeft: 'auto',
    paddingLeft: spacing.sm,
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
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  statusText: {
    ...typography.bodySmall,
  },
  writeCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginVertical: spacing.xs,
  },
  writeCtaText: {
    ...typography.label,
    fontSize: 13,
    fontWeight: '600',
  },
});
