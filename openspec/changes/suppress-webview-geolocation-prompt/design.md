## Context

`headless-browse-policy` requires genuinely non-incognito, single-user browsing of
third-party provider pages, with no circumvention beyond that tier. Two hidden WebViews
load third-party pages today: the ratings WebView (`ExternalRatingsSection`) and the
website-photo WebView (`WebsitePhotosWebView`). On iOS those pages' calls to
`navigator.geolocation` surface a per-origin system alert naming the website, because the
app holds precise-location authorization. WebKit's per-origin web-geolocation decision is
not something the app can pre-approve or pre-deny, so the fix has to be layered.

## Goals / Non-Goals

**Goals**

- No location (or other) system prompt can appear because of a hidden scrape, on any
  supported iOS version.
- The guard is one shared constant, not copy-pasted per WebView, and cannot affect the
  app's own location use.
- Behaviour is recorded in `headless-browse-policy` so the guard is not mistaken for
  anti-bot circumvention.

**Non-Goals**

- Extracting anything that needs location; the scrapers read the DOM only.
- Fixing Android (its WebView geolocation is already disabled by default) or the panorama
  viewer (app-owned HTML, not a third-party page).
- Upstreaming the native change (desirable, tracked separately).

## Decisions

### Decision 1: Two layers, because the platform hook is version-gated

React-native-webview 13.16.1/14.0.1 implements only
`requestMediaCapturePermissionForOrigin` and exposes no iOS geolocation prop
(`geolocationEnabled` is Android-only). The hook that lets an app deny silently,
`webView:requestGeolocationPermissionForOrigin:initiatedByFrame:decisionHandler:`, is
`ios(27.0)`-only, while the app's deployment target is 16.4. So:

1. **Always** inject `GEOLOCATION_GUARD_JS` before content (works on every version, and is
   the only lever on iOS ≤ 26).
2. **Additionally** patch the pod to deny the platform decision on iOS 27+, which is
   cleaner than a page-context stub and removes any dependence on how a page probes the
   API.

### Decision 2: The injected guard denies; it never fabricates

The script replaces `getCurrentPosition`/`watchPosition` (error with `code: 1`,
asynchronously, as the spec requires) and answers
`navigator.permissions.query({ name: 'geolocation' })` with `denied`. Unrelated permission
queries are delegated to the platform implementation. This removes access only — the same
outcome as tapping "Don't Allow" — which is why the change also records that denying is
not circumvention. It is injected for all frames; the platform prompt names the top-frame
origin today, but subframes can call the API too.

### Decision 3: A version-pinned pnpm patch, matching repo convention

The native change ships as `patches/react-native-webview@13.16.1.patch` registered in
`pnpm-workspace.yaml`, next to the existing MapLibre, `expo-modules-jsi`, and
`react-native-bare-kit` patches. The method is wrapped in
`#if __IPHONE_OS_VERSION_MAX_ALLOWED >= 270000` so builds against older SDKs still compile,
and it needs no `@available` guard because it only calls the decision handler.

## Risks / Trade-offs

- **Silent page-side degradation**: pages that block on a geolocation result now get an
  error instead of a position. Intentional — no scraped field depends on location.
- **Patch drift**: the pod patch must be revisited on a `react-native-webview` upgrade,
  like the repo's other patches. Upstreaming a `geolocationPermissionGrantType` prop
  would retire it.
- **iOS ≤ 26 relies on the injected layer only**: if a page were to probe geolocation from
  a native-only path, no app-side hook exists there; nothing observed does this.

## Migration Plan

1. Land the guard and prop wiring (JS only; no rebuild required to test on the simulator
   with a dev build that already contains the patch).
2. Rebuild natively so the pod patch takes effect (`pnpm install` applies the patch, then
   build; `pod install` is not required because the pod compiles from `node_modules`).
3. Verify on device: open a place whose card mounts the ratings and photo WebViews and
   confirm no location alert appears; confirm ratings and photos still resolve.

## Open Questions

- Should the same guard be extended to `requestDeviceOrientationAndMotionPermissionForOrigin`,
  which has the same prompt-by-default shape? No motion prompt has been observed.
