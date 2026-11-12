import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { GlassView } from '../common/GlassView';
import {
  useExternalRatings,
  type ExternalRatingProviderState,
} from '../../hooks/useExternalRatings';
import { assemblePoiAddress } from '../../services/poi/poiAddress';
import {
  combineExternalRatings,
  type CombinedRating,
} from '../../services/poi/externalRatings/combine';
import {
  placeRatingKey,
  setSessionPlaceRating,
} from '../../services/places/placeRatingSessionCache';
import { openInAppBrowser } from '../../utils/inAppBrowser';
import type { OsmPoi } from '../../services/poi/osmFetcher';
import type {
  ExternalRatingProviderId,
  ExternalRatingQuery,
  ExternalRatingSummary,
} from '../../services/poi/externalRatings/types';
import { borderRadius, spacing, typography } from '../../constants/theme';
import { hiddenBrowserHandlers, setHiddenBrowserSpec } from './HiddenRatingsBrowserHost';

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

/** No provider state while the gate is closed (avoids stale ratings flashing). */
const NO_STATES: ExternalRatingProviderState[] = [];

export function ExternalRatingsSection({
  poi,
  enrichedFormattedAddress,
  website,
  onWriteReview,
  enabled = true,
}: {
  poi: OsmPoi;
  enrichedFormattedAddress?: string | null;
  /** MapKit-enriched place website, used when OSM carries no website tag. */
  website?: string | null;
  /** Opens the write-a-review surface when no external rating is found. */
  onWriteReview?: () => void;
  /**
   * False while the card is still opening or already closing: the section
   * renders its loading placeholder but starts no fetch and loads no provider
   * page, so the sheet's spring animation is not competing with a page load.
   */
  enabled?: boolean;
}) {
  const { colors } = useTheme();

  const query = useMemo<ExternalRatingQuery>(
    () => ({
      name: poi.name,
      lat: poi.lat,
      lng: poi.lng,
      address: assemblePoiAddress(poi.tags, enrichedFormattedAddress ?? null),
      website:
        poi.tags['website'] ?? poi.tags['contact:website'] ?? poi.tags['url'] ?? website ?? null,
      tags: poi.tags,
    }),
    [poi, enrichedFormattedAddress, website],
  );

  const { states, handleMessage, handleError } = useExternalRatings(query, poi.id, enabled);

  // Ignore any state left over from a previous place while the gate is closed,
  // so a stale rating can't flash before the new pass starts. While the same
  // place is closing, keep showing what its pass last settled on, so the card
  // does not flash "Loading ratings…" as the sheet slides away.
  const activeStates = enabled ? states : NO_STATES;
  const lastShownRef = useRef<{
    placeId: string | number;
    states: ExternalRatingProviderState[];
  } | null>(null);
  useEffect(() => {
    if (enabled) lastShownRef.current = { placeId: poi.id, states };
  }, [enabled, states, poi.id]);
  const shownStates = enabled
    ? states
    : lastShownRef.current?.placeId === poi.id
      ? lastShownRef.current.states
      : NO_STATES;

  // Serialize hidden browsing: at most one stage is active at a time, in
  // registry order. There is no kept-alive browser: each stage mounts a fresh
  // WKWebView (see HiddenRatingsBrowserHost) — cookies persist in the shared
  // website-data store, so nothing is lost between stages.
  const activeWebView = activeStates.find((s) => s.webView)?.webView ?? null;
  const loaded = useMemo(
    () =>
      shownStates
        .filter((s) => s.status === 'loaded' && s.summary)
        .map((s) => s.summary as ExternalRatingSummary),
    [shownStates],
  );
  const combined = useMemo(() => combineExternalRatings(loaded), [loaded]);

  // Publish the resolved aggregate to the session cache so saved-list rows can
  // show it without ever triggering a provider load themselves.
  useEffect(() => {
    if (!combined) return;
    setSessionPlaceRating(placeRatingKey(poi), {
      rating: combined.rating,
      reviewCount: combined.reviewCount,
      sources: combined.sources,
      observedAt: combined.observedAt,
    });
  }, [combined, poi]);

  // Idle counts as resolving too, so the empty state never flashes before the
  // first resolution pass starts. A closed gate with nothing remembered also
  // counts as resolving: the section shows its loading placeholder while it
  // waits for the sheet.
  const resolving =
    shownStates.length === 0 ||
    shownStates.some(
      (s) => s.status === 'idle' || s.status === 'searching' || s.status === 'loading',
    );
  const blockedState = shownStates.find((s) => s.status === 'blocked') ?? null;

  // "No ratings yet" is a claim about the providers' answer; a transient
  // failure (timeout, pacing, network) is not one. Only a provider that
  // actually answered — a remembered verdict — may offer the write-a-review
  // CTA; a pass that died on retries gets an honest "couldn't load" row.
  const settledVerdict = shownStates.some(
    (s) => s.status === 'failed' && s.failedKind === 'verdict',
  );
  const settledRetry = shownStates.some((s) => s.status === 'failed' && s.failedKind === 'retry');

  // HTTP failures carry the status that distinguishes a block/rate limit from a
  // transient network error, so the controller can back the host off properly.
  // The hidden browser host reads these at event time; they must not re-render
  // it, so they live in a ref-shaped module slot.
  const handleHttpErrorEvent = useCallback(
    (provider: ExternalRatingProviderId, statusCode: number) => {
      // A 403 may still carry the block/challenge body; let the collector read
      // it instead of tearing the stage down. Subresource 4xx responses are
      // likewise not a verdict about the page.
      if (statusCode === 429 || statusCode >= 500) {
        handleError(provider, statusCode);
      }
    },
    [handleError],
  );
  useEffect(() => {
    hiddenBrowserHandlers.current = {
      onMessage: handleMessage,
      onError: (provider) => handleError(provider),
      onHttpError: handleHttpErrorEvent,
    };
  });

  // The hidden browser is rendered OUTSIDE the sheet's subtree (see
  // HiddenRatingsBrowserHost) — an actively loading WKWebView inside the
  // sheet's animated, clipped, Liquid Glass surface stalls the card for as
  // long as provider pages keep loading. This section publishes the live stage
  // while one runs and tears the browser down at every other moment — between
  // providers, after the pass settles, and while the card opens or closes.
  const browserSpecKey =
    enabled && activeWebView
      ? `${activeWebView.provider}|${activeWebView.stage}|${activeWebView.uri}`
      : 'off';
  useEffect(() => {
    if (browserSpecKey === 'off' || !activeWebView) {
      setHiddenBrowserSpec(null);
      return;
    }
    setHiddenBrowserSpec({
      uri: activeWebView.uri,
      provider: activeWebView.provider,
      injectedJavaScript: activeWebView.injectedJavaScript,
    });
    // The key fully describes the published spec; the values it was derived
    // from are intentionally not dependencies.
  }, [browserSpecKey]);

  return (
    <GlassView
      material="regular"
      testID="external-ratings-section"
      style={[styles.section, { borderColor: colors.border }]}
    >
      <View style={styles.titleRow}>
        <MaterialCommunityIcons name="star-outline" size={16} color={colors.textSecondary} />
        <Text style={[styles.title, { color: colors.text }]}>Reviews</Text>
      </View>

      {combined ? (
        <CombinedRatingBlock combined={combined} sources={loaded} colors={colors} />
      ) : resolving ? (
        <LoadingBlock colors={colors} />
      ) : blockedState ? (
        <BlockedBlock
          colors={colors}
          label={PROVIDER_LABEL[blockedState.provider]}
          reason={blockedState.blockReason ?? 'blocked'}
          testID="external-ratings-blocked"
        />
      ) : settledVerdict ? (
        <EmptyBlock colors={colors} onWriteReview={onWriteReview} />
      ) : settledRetry ? (
        <UnavailableBlock colors={colors} />
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
    void openInAppBrowser(url);
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

function UnavailableBlock({ colors }: { colors: ReturnType<typeof useTheme>['colors'] }) {
  return (
    <View style={styles.statusRow} testID="external-ratings-unavailable">
      <MaterialCommunityIcons name="wifi-off" size={16} color={colors.textSecondary} />
      <Text style={[styles.statusText, { color: colors.textSecondary, flexShrink: 1 }]}>
        Ratings couldn’t load right now. Reopen this place to try again.
      </Text>
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

function BlockedBlock({
  colors,
  label,
  reason,
  testID,
}: {
  colors: ReturnType<typeof useTheme>['colors'];
  label: string;
  reason: 'blocked' | 'paced';
  testID: string;
}) {
  return (
    <View style={styles.statusRow} testID={testID}>
      <MaterialCommunityIcons name="shield-alert-outline" size={16} color={colors.textSecondary} />
      <Text style={[styles.statusText, { color: colors.textSecondary, flexShrink: 1 }]}>
        {reason === 'blocked'
          ? `${label} is temporarily blocking review lookups from this network. Try again later.`
          : `${label} review lookups are paused to stay under its rate limits. Try again in a few minutes.`}
      </Text>
    </View>
  );
}

function renderStars(rating: number): string {
  const full = Math.round(rating);
  const clamped = Math.max(0, Math.min(5, full));
  return '★'.repeat(clamped) + '☆'.repeat(5 - clamped);
}

const styles = StyleSheet.create({
  section: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    borderRadius: borderRadius.lg,
    borderCurve: 'continuous',
    overflow: 'hidden',
    padding: spacing.md,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  title: {
    ...typography.label,
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
