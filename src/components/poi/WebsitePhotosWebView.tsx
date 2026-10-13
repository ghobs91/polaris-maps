import React, { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import {
  WEBSITE_PHOTOS_JS,
  countRealPhotos,
  extractPhotosFromWebViewMessage,
  resolveWebViewPhotoUrls,
} from '../../services/poi/websitePhotosService';
import { GEOLOCATION_GUARD_JS } from '../../constants/webViewScripts';

interface WebsitePhotosWebViewProps {
  /** Venue page to render (http/https only). */
  uri: string;
  /** Give up after this long; JS-rendered galleries hydrate within a few seconds. */
  timeoutMs?: number;
  /** Real photos wanted before settling early. */
  minPhotos?: number;
  /** Called with the accumulated photo URLs (already resolved/ranked). */
  onPhotos: (urls: string[]) => void;
  /** Called once when the fallback is done (photos found or timed out/failed). */
  onSettled?: () => void;
}

/** Normalize a hostname for same-site comparison (ignore `www.`, case, trailing dot). */
function siteKey(host: string): string {
  return host
    .toLowerCase()
    .replace(/\.$/, '')
    .replace(/^www\./, '');
}

/**
 * True for navigations this fallback may perform: the page's own site (apex and
 * `www.` treated as one) plus the WebView's initial `about:blank`. Non-web
 * schemes (`data:`, `blob:`, `file:`, `intent:`, …) and off-site redirects are
 * rejected, mirroring the bounded headless-browse policy.
 */
export function isAllowedWebsitePhotoUrl(rawUrl: string, baseUrl: string): boolean {
  if (rawUrl === 'about:blank') return true;
  let target: URL;
  let base: URL;
  try {
    target = new URL(rawUrl);
    base = new URL(baseUrl);
  } catch {
    return false;
  }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') return false;
  return siteKey(target.hostname) === siteKey(base.hostname);
}

/**
 * Hidden, zero-size WebView that renders a venue website so JavaScript-built
 * galleries (Squarespace/Wix/Shopify/Square, …) can be extracted. The injected
 * script collects gallery images, `<img>`/CSS-background photos, and metadata,
 * then posts them back; the host page is never shown to the user.
 */
export function WebsitePhotosWebView({
  uri,
  timeoutMs = 15_000,
  minPhotos = 3,
  onPhotos,
  onSettled,
}: WebsitePhotosWebViewProps) {
  const accumulated = useRef<Set<string>>(new Set());
  const settled = useRef(false);

  const settle = useCallback(() => {
    if (settled.current) return;
    settled.current = true;
    onSettled?.();
  }, [onSettled]);

  useEffect(() => {
    settled.current = false;
    accumulated.current = new Set();
  }, [uri]);

  useEffect(() => {
    const timer = setTimeout(settle, timeoutMs);
    return () => clearTimeout(timer);
  }, [settle, timeoutMs]);

  const handleMessage = useCallback(
    (event: { nativeEvent: { data: string } }) => {
      if (settled.current) return;
      const raw = extractPhotosFromWebViewMessage(event.nativeEvent.data);
      if (!raw || raw.length === 0) return;
      const resolved = resolveWebViewPhotoUrls(raw, uri);
      if (resolved.length === 0) return;
      for (const url of resolved) accumulated.current.add(url);
      const all = [...accumulated.current];
      onPhotos(all);
      if (countRealPhotos(all) >= minPhotos) settle();
    },
    [minPhotos, onPhotos, settle, uri],
  );

  const handleShouldStart = useCallback(
    (request: { url: string }) => isAllowedWebsitePhotoUrl(request.url, uri),
    [uri],
  );

  return (
    <View style={styles.hidden} pointerEvents="none">
      <WebView
        source={{ uri }}
        style={styles.hidden}
        injectedJavaScript={WEBSITE_PHOTOS_JS}
        injectedJavaScriptBeforeContentLoaded={GEOLOCATION_GUARD_JS}
        injectedJavaScriptBeforeContentLoadedForMainFrameOnly={false}
        javaScriptEnabled
        domStorageEnabled
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        mediaPlaybackRequiresUserAction
        setSupportMultipleWindows={false}
        onShouldStartLoadWithRequest={handleShouldStart}
        onMessage={handleMessage}
        onError={settle}
        onHttpError={settle}
        testID="place-media-webview"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: {
    width: 0,
    height: 0,
    opacity: 0,
  },
});
