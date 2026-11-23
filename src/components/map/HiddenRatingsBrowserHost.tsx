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
 * Mounting policy: the WebView is mounted FRESH per stage (keyed by the stage
 * URI) and unmounted whenever no stage is live. The previous keep-alive scheme
 * — unloading a stage by pointing the kept-alive WebView at a blank `html`
 * document — silently broke every stage that followed: on iOS the `html → uri`
 * source switch never triggered a page load (react-native-webview parks
 * `decidePolicyForNavigationAction` on a JS round-trip with no timeout, and the
 * URI path wraps `loadRequest` in a cookie-sync dispatch group), so the second
 * provider's stage sat silent until the stage clock killed it. The same failure
 * came back when a single view was reused by navigating it between stage URIs
 * (`uri → uri`): on device every provider stage then sat silent until its clock
 * expired, so ratings never loaded. A fresh view per stage is the only mounting
 * policy that has been observed to load on a real device — do not "optimise"
 * this back into a reused view.
 *
 * NEVER point this WebView at a URL without a host (`about:blank`, `data:…`):
 * react-native-webview routes a host-less `source` to
 * `-[WKWebView loadFileURL:allowReadAccessToURL:]`, which raises an ObjC
 * exception on the main thread and aborts the app (observed as SIGABRT in a
 * release build). To release a page, unmount the view — never blank it.
 *
 * Cookies are NOT lost by remounting: they live in the shared, persistent
 * WKWebsiteDataStore, so each stage still starts with a warmed cookie jar.
 *
 * `sharedCookiesEnabled` is deliberately OFF. It does not give this browser
 * anything: nothing in the app writes to `NSHTTPCookieStorage` (the in-app
 * browser is a Safari view controller, whose cookies live in Safari's store),
 * so the flag only makes react-native-webview enumerate EVERY cookie in the
 * shared jar on the MAIN THREAD and write them into the web view one by one on
 * every single navigation, holding `loadRequest` until all of them complete.
 * That cost scales with how long the device has been used — a fresh simulator
 * has a near-empty jar, a real phone does not — which is exactly the shape of
 * the reported "the card locks up until the ratings finish" (and of the stage
 * that never loads at all). Provider cookies a page sets live in the persistent
 * WKWebsiteDataStore and survive the per-stage remount regardless.
 */

import { useEffect, useSyncExternalStore } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { WebView } from 'react-native-webview';
import {
  isHiddenBrowserDisabled,
  mark,
  noteBrowser,
} from '../../services/poi/externalRatings/devRatingsLagProbe';
import {
  EXTERNAL_RATINGS_USER_AGENT,
  isAllowedExternalRatingUrl,
  providerById,
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
 * Renders the hidden browser wherever an ancestor that is never animated or
 * clipped can host it (e.g. beside the place sheet). Renders nothing while no
 * card is resolving ratings.
 */
export function HiddenRatingsBrowserHost() {
  const spec = useSyncExternalStore(subscribeHiddenBrowser, getHiddenBrowserSpec);
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

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

  // Mount/unmount of a WKWebView mid-load is expensive native work; the lag
  // probe records both so a freeze can be tied to one of them.
  //
  // The `mark` pair brackets the React commit that CREATES the view (a
  // WKWebView plus a web-content process, on the main thread). A stall between
  // `browser create` and `mount` is therefore the creation itself, not the page
  // load — that is the cost the reported "card locks up while ratings load"
  // needs to be attributed to, or ruled out against.
  const specKey = spec ? `${spec.provider}|${spec.uri}` : null;
  useEffect(() => {
    if (!specKey) return;
    noteBrowser(`mount ${specKey}`);
    return () => noteBrowser(`unmount ${specKey}`);
  }, [specKey]);
  useEffect(() => {
    if (specKey) mark(`browser create → ${specKey}`);
  }, [specKey]);

  // Dev-only A/B switch: prove whether the hidden browser is the cost by
  // running the same flow with it never mounted.
  if (isHiddenBrowserDisabled()) return null;
  if (!spec) return null;

  return (
    <View style={hiddenBrowserStyle} pointerEvents="none">
      <WebView
        // A fresh WKWebView per stage: remounting is what makes every stage
        // take the always-works load path (see the class comment).
        key={`${spec.provider}|${spec.uri}`}
        source={{ uri: spec.uri }}
        style={hiddenBrowserStyle}
        // Per provider: mobile for TripAdvisor (a desktop UA is 403'd),
        // desktop for Yelp (its mobile site omits listing identity).
        userAgent={providerById(spec.provider).userAgent || EXTERNAL_RATINGS_USER_AGENT}
        injectedJavaScript={spec.injectedJavaScript ?? undefined}
        injectedJavaScriptBeforeContentLoaded={GEOLOCATION_GUARD_JS}
        injectedJavaScriptBeforeContentLoadedForMainFrameOnly={false}
        javaScriptEnabled
        domStorageEnabled
        cacheEnabled
        // Deliberately NOT sharedCookiesEnabled — see the class comment: it is a
        // per-navigation, main-thread, O(cookies) copy that this browser gets
        // nothing from, and it holds page loads until it completes.
        sharedCookiesEnabled={false}
        thirdPartyCookiesEnabled
        mediaPlaybackRequiresUserAction
        javaScriptCanOpenWindowsAutomatically={false}
        allowsLinkPreview={false}
        setSupportMultipleWindows={false}
        onShouldStartLoadWithRequest={handleShouldStartLoad}
        onLoadStart={(event) => {
          noteBrowser(`loadStart ${spec.provider} ${event.nativeEvent.url}`);
        }}
        onLoadEnd={(event) => {
          noteBrowser(`loadEnd ${spec.provider} ${event.nativeEvent.url}`);
        }}
        onMessage={(event) => {
          noteBrowser(`message ${spec.provider} ${event.nativeEvent.data.slice(0, 700)}`);
          hiddenBrowserHandlers.current?.onMessage(spec.provider, event.nativeEvent.data);
        }}
        onError={(event) => {
          const detail = event?.nativeEvent;
          noteBrowser(`error ${spec.provider} ${detail?.code ?? '?'} ${detail?.description ?? ''}`);
          hiddenBrowserHandlers.current?.onError(spec.provider);
        }}
        onHttpError={(event) => {
          noteBrowser(
            `httpError ${spec.provider} ${event.nativeEvent.statusCode} ${event.nativeEvent.url}`,
          );
          hiddenBrowserHandlers.current?.onHttpError(spec.provider, event.nativeEvent.statusCode);
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
  const allowed = request.url === 'about:blank' || isAllowedExternalRatingUrl(request.url);
  if (!allowed) {
    noteBrowser(`blockedNav ${request.url}`);
  }
  return allowed;
}
