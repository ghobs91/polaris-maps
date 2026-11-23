/**
 * Off-screen host for the external-ratings hidden browser.
 *
 * The ratings section resolves provider pages through one hidden WKWebView.
 * That WebView must NOT live inside the place sheet's subtree: the sheet is a
 * Reanimated-animated, gesture-panned, scroll-clipped, Liquid Glass surface, and
 * an actively loading WKWebView inside it stalls the card for as long as the
 * pages keep loading. A transparent RN `Modal` window is not an alternative
 * either — on iOS it intercepts every touch (even with `pointerEvents="none"`)
 * and freezes the whole screen.
 *
 * So the browser is hosted here instead, as a sibling of the bottom sheet in a
 * plain, never-transformed container. The section publishes what the browser
 * should load through the module-level spec below; event handlers are read from
 * the shared `hiddenBrowserHandlers` ref at event time, so the host renders a
 * structurally stable WebView that never reloads on section re-renders.
 *
 * Mounting policy: ONE WKWebView per pass (see {@link HiddenRatingsBrowserHost}),
 * created when the first stage opens and driven by `source` afterwards — never
 * remounted between stages. Creating and destroying a WKWebView is the most
 * expensive native work this feature can do (a fresh web-content process, a new
 * configuration, a cookie-store sync), and the previous scheme did it once per
 * stage: up to four times while a single place card sat open. Navigating an
 * existing browser between stage URIs takes the always-works `uri → uri` load
 * path.
 *
 * When no stage is live the view is unmounted after a short grace window, so an
 * idle app holds no web-content process and no provider page keeps rendering
 * behind the card. The grace window only exists to bridge a stage handoff
 * between providers without paying for a teardown and a rebuild.
 *
 * NEVER park the browser on a URL without a host (`about:blank`, `data:…`):
 * react-native-webview routes a host-less `source` to
 * `-[WKWebView loadFileURL:allowingReadAccessToURL:]`, which raises an ObjC
 * exception on the main thread and aborts the app. This is not hypothetical —
 * it is how an `about:blank` parking scheme crashed the release build.
 * Cookies are not lost by unmounting: they live in the shared, persistent
 * WKWebsiteDataStore.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { WebView } from 'react-native-webview';
import {
  isHiddenBrowserDisabled,
  noteBrowser,
} from '../../services/poi/externalRatings/devRatingsLagProbe';
import {
  EXTERNAL_RATINGS_USER_AGENT,
  isAllowedExternalRatingUrl,
} from '../../services/poi/externalRatings';
import { GEOLOCATION_GUARD_JS } from '../../constants/webViewScripts';
import type { ExternalRatingProviderId } from '../../services/poi/externalRatings/types';

export interface HiddenBrowserSpec {
  /** The provider page this stage loads. */
  uri: string;
  /** Provider the active stage belongs to. */
  provider: ExternalRatingProviderId;
  /** The active stage's collector script. */
  injectedJavaScript: string;
}

export interface HiddenBrowserHandlers {
  onMessage: (provider: ExternalRatingProviderId, data: string) => void;
  onError: (provider: ExternalRatingProviderId) => void;
  onHttpError: (provider: ExternalRatingProviderId, statusCode: number) => void;
}

let currentSpec: HiddenBrowserSpec | null = null;
const listeners = new Set<() => void>();

/** Publish the browser state; the host re-renders on identity change only. */
export function setHiddenBrowserSpec(spec: HiddenBrowserSpec | null): void {
  currentSpec = spec;
  listeners.forEach((listener) => listener());
}

export function getHiddenBrowserSpec(): HiddenBrowserSpec | null {
  return currentSpec;
}

export function subscribeHiddenBrowser(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Event handlers, written by the ratings section on every render and read by
 * the host at event time (the host must not re-render when they change).
 */
export const hiddenBrowserHandlers: { current: HiddenBrowserHandlers | null } = { current: null };

/**
 * How long the browser view stays alive with no stage live.
 *
 * A pass can hand off from one provider's stage to the next with a brief gap, and
 * tearing the view down for that gap would pay the expensive part (web-content
 * process teardown and re-creation) on every handoff. Short — a provider page
 * must not keep rendering behind a settled card.
 */
const IDLE_RELEASE_MS = 1_500;

/**
 * Renders the hidden browser wherever an ancestor that is never animated or
 * clipped can host it (e.g. beside the place sheet). Renders nothing while no
 * card is resolving ratings and the idle grace window has expired.
 */
export function HiddenRatingsBrowserHost() {
  const spec = useSyncExternalStore(subscribeHiddenBrowser, getHiddenBrowserSpec);
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

  /** The URI the single WebView is loaded with; null when the view is unmounted. */
  const [uri, setUri] = useState<string | null>(null);
  /** Provider whose stage owns the current document (handlers read it live). */
  const liveProvider = useRef<ExternalRatingProviderId | null>(null);
  liveProvider.current = spec?.provider ?? null;

  // A real browser viewport, not a 0×0 frame: `innerWidth`/`innerHeight` are
  // part of every bot-detection fingerprint, and a zero-size viewport is an
  // unambiguous headless signal. The view sits entirely off screen so it stays
  // invisible without distorting layout.
  const hiddenBrowserStyle = {
    position: 'absolute' as const,
    left: -windowWidth * 2,
    top: 0,
    width: windowWidth,
    height: windowHeight,
    opacity: 0,
  };

  useEffect(() => () => setHiddenBrowserSpec(null), []);

  // Drive the ONE browser: a live stage navigates it; no stage releases it after
  // the grace window. Never remount between stages, and never navigate to a
  // host-less URL (see the class comment: that aborts the app).
  useEffect(() => {
    if (spec) {
      setUri(spec.uri);
      return;
    }
    const timer = setTimeout(() => setUri(null), IDLE_RELEASE_MS);
    return () => clearTimeout(timer);
  }, [spec]);

  // Mount/unmount of a WKWebView is expensive native work; the lag probe
  // records both so a freeze can be tied to one of them.
  useEffect(() => {
    if (uri === null) return;
    noteBrowser(`mount ${uri}`);
    return () => noteBrowser(`unmount ${uri}`);
  }, [uri === null]);

  // Dev-only A/B switch: prove whether the hidden browser is the cost by
  // running the same flow with it never mounted.
  if (isHiddenBrowserDisabled()) return null;
  if (uri === null) return null;

  return (
    <View style={hiddenBrowserStyle} pointerEvents="none">
      <WebView
        // No `key`: this instance survives every stage of a pass.
        source={{ uri }}
        style={hiddenBrowserStyle}
        userAgent={EXTERNAL_RATINGS_USER_AGENT}
        injectedJavaScript={spec?.injectedJavaScript ?? undefined}
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
        onMessage={(event) => {
          const provider = liveProvider.current;
          if (!provider) return;
          hiddenBrowserHandlers.current?.onMessage(provider, event.nativeEvent.data);
        }}
        onError={() => {
          const provider = liveProvider.current;
          if (!provider) return;
          hiddenBrowserHandlers.current?.onError(provider);
        }}
        onHttpError={(event) => {
          const provider = liveProvider.current;
          if (!provider) return;
          hiddenBrowserHandlers.current?.onHttpError(provider, event.nativeEvent.statusCode);
        }}
      />
    </View>
  );
}

/**
 * Reject any navigation that leaves the provider host allowlist or uses a
 * non-web scheme (`headless-browse-policy`). `about:blank` is the WebView's
 * own initial document.
 */
function handleShouldStartLoad(request: { url: string }): boolean {
  return request.url === 'about:blank' || isAllowedExternalRatingUrl(request.url);
}
