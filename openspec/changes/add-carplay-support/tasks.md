## 1. Native sources (canonical, in `plugins/native/PolarisMaps/`)

- [x] 1.1 Create `PolarisCarPlay.swift` — singleton module: static scene-state buffering (`pendingInterfaceController`, `isSceneConnected`, `attachPendingSceneIfNeeded()`), template construction (map template, search list templates), navigation session management, event emission for `carPlayConnected`/`carPlayDisconnected`/`searchQuery`/`searchResultSelected`, and all spec methods (`updateNavigation`, `startNavigation`, `endNavigation`, `pushSearchResults`, `updateMapCenter`, `isConnected`)
- [x] 1.2 Create `PolarisCarPlay.m` / `PolarisCarPlay-Bridging.m` — Objective-C bridge registering the TurboModule with React
- [x] 1.3 Create `CarPlaySceneDelegate.swift` — implements `CPTemplateApplicationSceneDelegate`, hosts the map template via `PolarisCarPlay.sceneDidConnect`/`.sceneDidDisconnect`
- [x] 1.4 Implement the CarPlay map view wrapper (`MLNMapView` in the CarPlay window): style from loopback tile server, route polyline decode/draw from `encodedPolyline`, camera tracking from `updateMapCenter`, lazy create/teardown on connect/disconnect

## 2. Config plugin (`plugins/withCarPlay.js`)

- [x] 2.1 Copy native files into `ios/PolarisMaps/` and register them in the Xcode project (`CarPlaySceneDelegate.swift`, `PolarisCarPlay.swift`, `PolarisCarPlay-Bridging.m`) following `withCloudStore.js` patterns
- [x] 2.2 Inject Info.plist keys: `UISupportsCarPlay` and `CPTemplateApplicationSceneSessionRoleApplication` scene config pointing at `$(PRODUCT_MODULE_NAME).CarPlaySceneDelegate` (merge-safe with `withSceneLifecycle.js`)
- [x] 2.3 Patch AppDelegate `configurationForConnecting` to route CarPlay-role sessions to `CarPlaySceneDelegate`
- [x] 2.4 Add entitlements files (`PolarisMaps.Debug.entitlements`, `PolarisMaps.SimulatorCarPlay.entitlements`) with the per-config split pinned by tests; set `CODE_SIGN_ENTITLEMENTS[sdk=iphonesimulator*]`; preserve/add the two “Remove signature files (Xcode workaround)” phases and `app-Simulated.xcent` behavior
- [x] 2.5 Register `./plugins/withCarPlay` in `app.json` plugins array

## 3. Verification

- [x] 3.1 Run targeted Jest: `carPlayXcodeConfig.test.ts` (green); `carPlayManager.test.ts` fails on clean main too (pre-existing Jest ESM transform issue, unchanged by this work)
- [x] 3.2 Run `pnpm typecheck && pnpm lint && pnpm format:check`
- [x] 3.3 Apply plugin output to existing checked-in `ios/` (manual application); app builds (`BUILD SUCCEEDED`), installs and launches on booted simulator, `pnpm carplay:doctor` reports "carplay scene: present" — but doctor still exits 1 because the installed app has no CarPlay entitlement (see pause note)
- [ ] 3.4 Manual smoke test: `pnpm carplay:sim`, open Apple CarPlay simulator window, verify map renders, search returns results, selecting a destination starts a trip preview + navigation session
