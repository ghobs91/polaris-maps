import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { GlassView } from '../common/GlassView';
import {
  useExternalRatings,
  type ExternalRatingProviderState,
  type ExternalRatingWebViewStage,
} from '../../hooks/useExternalRatings';
import { assemblePoiAddress } from '../../services/poi/poiAddress';
import {
  EXTERNAL_RATINGS_USER_AGENT,
  isAllowedExternalRatingUrl,
} from '../../services/poi/externalRatings';
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
import { GEOLOCATION_GUARD_JS } from '../../constants/webViewScripts';

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

/**
 * Static document used to unload a provider page without unmounting the hidden
 * WKWebView (which would lose its warmed cookie/clearance store). Must be an
 * `html` source: a hostless `uri` such as `about:blank` is routed by
 * react-native-webview to `WKWebView loadFileURL:`, which throws for non-file
 * URLs and terminates the app.
 */
const BLANK_BROWSER_DOCUMENT =
  '<!doctype html><html><head><meta charset="utf-8"><title>about:blank</title></head><body></body></html>';

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
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

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
  // registry order. The WebView instance is kept mounted (with its warmed
  // cookie store) across stages and providers while the card is open, so a
  // cleared DataDome session is not lost to a cold remount.
  const activeWebView = activeStates.find((s) => s.webView)?.webView ?? null;
  const lastWebViewRef = useRef<{
    placeId: string | number;
    stage: ExternalRatingWebViewStage;
  } | null>(null);
  useEffect(() => {
    if (activeWebView) lastWebViewRef.current = { placeId: poi.id, stage: activeWebView };
  }, [activeWebView, poi.id]);
  // Only remount the kept-alive view for the place it came from.
  const rememberedWebView =
    lastWebViewRef.current?.placeId === poi.id ? lastWebViewRef.current.stage : null;
  const mountedWebView = activeWebView ?? rememberedWebView;
  // Load a provider page only while its stage is live. At every other moment —
  // between providers, after the pass settles, and while the card is closing —
  // the kept-alive browser is pointed at a blank document instead. The WKWebView
  // instance (and its cookie store) survives, but no third-party page keeps
  // rendering and competing with the card for the main thread, and the card can
  // slide away without a repeated 403/ad bundle still running behind it.
  //
  // The blank must be an `html` source, never `{ uri: 'about:blank' }`:
  // react-native-webview's iOS `visitSource` routes any URL without a host to
  // `WKWebView loadFileURL:`, and WebKit raises (SIGTRAP in the app) for a
  // non-file URL. A static HTML document takes the `loadHTMLString:` path and
  // unloads the previous provider page just the same.
  const browserSource = activeWebView
    ? { uri: activeWebView.uri }
    : { html: BLANK_BROWSER_DOCUMENT };
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

  // A real browser viewport, not a 0×0 frame: `innerWidth`/`innerHeight` are
  // part of every bot-detection fingerprint, and a zero-size viewport is an
  // unambiguous headless signal. The view is positioned outside the card's
  // clipped bounds so it stays invisible without distorting layout.
  const hiddenBrowserStyle = useMemo(
    () => ({
      position: 'absolute' as const,
      left: -windowWidth * 2,
      top: 0,
      width: windowWidth,
      height: windowHeight,
      opacity: 0,
    }),
    [windowWidth, windowHeight],
  );

  const handleMessageEvent = useCallback(
    (provider: ExternalRatingProviderId) => (event: { nativeEvent: { data: string } }) => {
      handleMessage(provider, event.nativeEvent.data);
    },
    [handleMessage],
  );

  // HTTP failures carry the status that distinguishes a block/rate limit from a
  // transient network error, so the controller can back the host off properly.
  const handleHttpErrorEvent = useCallback(
    (event: { nativeEvent: { statusCode: number } }) => {
      if (!activeWebView) return;
      const statusCode = event.nativeEvent.statusCode;
      // A 403 may still carry the block/challenge body; let the collector read
      // it instead of tearing the stage down. Subresource 4xx responses are
      // likewise not a verdict about the page.
      if (statusCode === 429 || statusCode >= 500) {
        handleError(activeWebView.provider, statusCode);
      }
    },
    [activeWebView, handleError],
  );

  // Reject any navigation that leaves the provider host allowlist or uses a
  // non-web scheme (`headless-browse-policy`). `about:blank` is the WebView's
  // own initial document.
  const handleShouldStartLoad = useCallback(
    (request: { url: string }) =>
      request.url === 'about:blank' || isAllowedExternalRatingUrl(request.url),
    [],
  );

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

      {mountedWebView ? (
        <View style={hiddenBrowserStyle} pointerEvents="none">
          <WebView
            source={browserSource}
            style={hiddenBrowserStyle}
            userAgent={EXTERNAL_RATINGS_USER_AGENT}
            injectedJavaScript={activeWebView ? activeWebView.injectedJavaScript : undefined}
            injectedJavaScriptBeforeContentLoaded={GEOLOCATION_GUARD_JS}
            injectedJavaScriptBeforeContentLoadedForMainFrameOnly={false}
            javaScriptEnabled
            domStorageEnabled
            cacheEnabled
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
            mediaPlaybackRequiresUserAction
            javaScriptCanOpenWindowsAutomatically={false}
            allowsLinkPreview={false}
            setSupportMultipleWindows={false}
            onShouldStartLoadWithRequest={handleShouldStartLoad}
            onMessage={activeWebView ? handleMessageEvent(activeWebView.provider) : undefined}
            onError={activeWebView ? () => handleError(activeWebView.provider) : undefined}
            onHttpError={activeWebView ? handleHttpErrorEvent : undefined}
          />
        </View>
      ) : null}

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
