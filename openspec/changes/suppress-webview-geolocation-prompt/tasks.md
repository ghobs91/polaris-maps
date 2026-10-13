## 1. Shared injected guard

- [x] 1.1 Create `src/constants/webViewScripts.ts` exporting `GEOLOCATION_GUARD_JS` (ES5 IIFE: deny `getCurrentPosition`/`watchPosition` with `PERMISSION_DENIED`, `clearWatch` inert, `permissions.query({ name: 'geolocation' })` → `denied`, unrelated queries delegated)
- [x] 1.2 Unit-test the script by evaluating it against a fake `navigator`: denial without reaching the platform methods, inert watch id, denied permission state, delegation for other permission names, and no throw with no `navigator` APIs
- [x] 1.3 Wire the guard into `ExternalRatingsSection`'s hidden ratings WebView (`injectedJavaScriptBeforeContentLoaded`, all frames)
- [x] 1.4 Wire the guard into `WebsitePhotosWebView` (`injectedJavaScriptBeforeContentLoaded`, all frames)
- [x] 1.5 Assert the wiring in `ExternalRatingsSection.test.tsx` and `placeMediaCarousel.test.tsx`

## 2. Native deny on iOS 27+

- [x] 2.1 Patch `react-native-webview` (`apple/RNCWebViewImpl.m`) to implement `webView:requestGeolocationPermissionForOrigin:initiatedByFrame:decisionHandler:` returning `WKPermissionDecisionDeny`, guarded by `__IPHONE_OS_VERSION_MAX_ALLOWED >= 270000`
- [x] 2.2 Commit the patch as `patches/react-native-webview@13.16.1.patch` and register it in `pnpm-workspace.yaml` `patchedDependencies`
- [x] 2.3 Verify the patched pod compiles (`xcodebuild -project ios/Pods/Pods.xcodeproj -target react-native-webview -sdk iphonesimulator`)
- [ ] 2.4 Rebuild the app natively and confirm the method is linked (on-device check)

## 3. Policy record

- [x] 3.1 Add the `headless-browse-policy` delta: no platform permission prompts from headless browsing, and denying access is not circumvention
- [x] 3.2 Write proposal, design, and tasks for this change

## 4. Verification

- [x] 4.1 Run `pnpm typecheck`
- [x] 4.2 Run `pnpm lint` and `pnpm format:check` on the touched files
- [x] 4.3 Run the affected Jest suites (`webViewGeolocationGuard`, `ExternalRatingsSection`, `placeMediaCarousel`)
- [ ] 4.4 On-device check: open a place card and confirm no location alert appears while ratings and photos still resolve
