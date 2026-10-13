## Why

Opening a place card mounts the hidden ratings WebViews (TripAdvisor, Yelp) and — for
venues without open-licensed media — the hidden website-photo WebView. Those third-party
pages call `navigator.geolocation` on load, and on iOS the platform WebView answers that
call with a per-origin system alert naming the site ("“www.tripadvisor.com” would like to
use your current location"), shown because the app already holds precise-location
authorization. The user therefore gets a location modal over the map every time ratings
load, and it has nothing to do with the feature: the scrapers read data already present in
the DOM (JSON-LD, `data-automation`, image tags) and never need the device's location.

## What Changes

- **Neutralize web geolocation before page scripts run** in every hidden third-party
  WebView through one shared injected-before-content script (`GEOLOCATION_GUARD_JS`):
  `getCurrentPosition`/`watchPosition` fail immediately with `PERMISSION_DENIED` and
  `navigator.permissions.query({ name: 'geolocation' })` reports `denied`, so the page's
  request never reaches WebKit and no prompt is raised. Applied to the ratings WebView and
  the website-photo WebView, for all frames.
- **Deny the platform decision where the platform asks the app** by patching
  `react-native-webview` to implement
  `webView:requestGeolocationPermissionForOrigin:initiatedByFrame:decisionHandler:` with
  `WKPermissionDecisionDeny` (iOS 27+; WebKit's default when that method is unimplemented
  is the system prompt). Version-pinned pnpm patch, like the repo's other native patches.
- **Record the policy intent**: denying web geolocation is the same decision a user makes by
  tapping "Don't Allow". It removes access and never fabricates a granted or human-like
  state, so it is not the "forging permission state" the bounded-circumvention clause
  prohibits.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `headless-browse-policy`: add a requirement that headless browsing SHALL NOT trigger
  platform permission prompts and SHALL present a denied geolocation state, and clarify
  that reducing the app's own access is outside the circumvention prohibition.

## Impact

- **UI**: `src/components/map/ExternalRatingsSection.tsx` and
  `src/components/poi/WebsitePhotosWebView.tsx` pass the guard and set
  `injectedJavaScriptBeforeContentLoadedForMainFrameOnly={false}`.
- **Constants**: new `src/constants/webViewScripts.ts` exporting `GEOLOCATION_GUARD_JS`
  (ES5, safe inside third-party pages).
- **Native**: new `patches/react-native-webview@13.16.1.patch` registered in
  `pnpm-workspace.yaml` `patchedDependencies`; requires a native rebuild (already verified
  to compile against the iOS 27 SDK).
- **Tests**: new `__tests__/unit/webViewGeolocationGuard.test.ts` (behaviour of the
  injected script); prop-wiring assertions in `ExternalRatingsSection.test.tsx` and
  `placeMediaCarousel.test.tsx`.
- **Non-goals**: no change for Android (geolocation is already disabled by WebView
  defaults) and none for the panorama viewer (it renders app-owned HTML, not third-party
  pages); the injected guard is what covers iOS 16.4–26, where no platform hook exists.
