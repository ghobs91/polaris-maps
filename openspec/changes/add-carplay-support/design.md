## Context

The TypeScript CarPlay layer is complete (`src/native/carplay/*`, `src/services/carplay/carPlayManager.ts`, wired in `app/_layout.tsx`) and calls a native TurboModule named `PolarisCarPlay` that does not exist. A unit test suite (`__tests__/unit/carPlayXcodeConfig.test.ts`) pins the full expected iOS configuration — scene registration, delegate/module source files, entitlements split, and Xcode project entries — and currently fails because `expo prebuild --clean` regenerated `ios/` without the CarPlay pieces. Simulator tooling (`scripts/install-carplay-simulator.sh`, `resign-carplay-simulator-app.sh`, `doctor-carplay-simulator.sh`, `pnpm carplay:*`) already exists and expects specific entitlement/plist/project shapes.

Repo convention: native sources live canonically in `plugins/native/` and are copied into generated `ios/` by Expo config plugins (see `plugins/withCloudStore.js`), which also register sources in `project.pbxproj` and patch the bridging header. Editing `ios/` directly does not survive prebuild.

The app already runs a loopback-only tile server (`PolarisTileServer`) and uses `@maplibre/maplibre-react-native` whose pod embeds the MapLibre Native dynamic library.

## Goals / Non-Goals

**Goals:**

- Native `PolarisCarPlay` TurboModule implementing the existing TS spec exactly (methods + events)
- CarPlay scene lifecycle that survives `expo prebuild --clean` via a config plugin
- Full live map on the CarPlay display (vector rendering, route polyline, maneuver panel, trip preview)
- Search list templates driven by `unifiedSearch` through the existing manager
- Make `__tests__/unit/carPlayXcodeConfig.test.ts` pass as the acceptance contract
- Add entitlement wiring consistent with the simulator resign workflow and Apple review constraints

**Non-Goals:**

- Android Auto
- Voice/audio guidance prompts on CarPlay (phone-side audio only)
- Instrument cluster (second-screen) rendering
- Changes to the TypeScript module API or `carPlayManager.ts`

## Decisions

### D1: Ship native code via a new `withCarPlay` config plugin (restore-on-prebuild)

New `plugins/withCarPlay.js` modeled on `withCloudStore.js`:

- Canonical sources in `plugins/native/PolarisMaps/`: `PolarisCarPlay.swift`, `PolarisCarPlay.m`, `PolarisCarPlay-Bridging.m` (bridging entry registering the ObjC class), `CarPlaySceneDelegate.swift`; copied to `ios/PolarisMaps/`
- Registered in the Xcode project via `project.addSourceFile(...)` against the `PolarisMaps` group/main target
- Injects into `Info.plist`: `UISupportsCarPlay = true` and a `CPTemplateApplicationSceneSessionRoleApplication` scene configuration pointing at `$(PRODUCT_MODULE_NAME).CarPlaySceneDelegate` (alongside the existing phone `UIWindowSceneSessionRoleApplication`)
- Patches `AppDelegate.configurationForConnecting` handling so CarPlay-role sessions get `CarPlaySceneDelegate` and phone sessions keep `SceneDelegate`

Why: direct edits to `ios/` were already lost once to prebuild. Alternatives considered: hand-editing `ios/` (rejected — regression risk), committing generated `ios/` changes only (rejected — next prebuild wipes them).

### D2: Live map via a second MapLibre render target attached to the CarPlay window

`CarPlaySceneDelegate` creates an `MLNMapView` (MapLibre Native, available from the existing `maplibre-react-native/DynamicLibrary` pod) and hosts it in the `CPWindow` hierarchy of the template application scene. Style URL reuses the app style served by `PolarisTileServer` (loopback). Route geometry (`encodedPolyline` from `startNavigation`) is decoded and drawn as a polyline layer natively; camera follows position updates from `updateMapCenter`.

Alternatives considered:

- `MKMapView` + `MKTileOverlay` proxying the local tile server: raster-only, no style parity with the phone map, Apple Maps attribution/logo requirements, weaker vector label control. Rejected.
- Snapshot-per-frame streaming from the phone map: high CPU/battery, laggy. Rejected.

Risk mitigation: if MapLibre Metal rendering proves unstable inside a CarPlay scene on some OS versions, fall back to snapshot mode behind a single internal seam (the map view wrapper), keeping the module API unchanged.

### D3: Scene-state buffering in `PolarisCarPlay.swift`

CarPlay scenes can connect before React attaches the native module listener. Per the pinned test contract, the Swift singleton keeps `private static var pendingInterfaceController`, `private static var isSceneConnected = false`, calls `attachPendingSceneIfNeeded()` when the RN bridge initialises, and `isConnected()` resolves with `resolve(Self.isSceneConnected)` rather than touching a possibly-absent interface controller. Events (`carPlayConnected`, `carPlayDisconnected`, `searchQuery`, `searchResultSelected`) are emitted through the module's emitter once attached; connection state set by the scene delegate is replayed.

### D4: Templates

- Root: `CPMapTemplate` (navigation app) with map buttons (recenter, overview/zoom, mute-less UI kept minimal) and `CPNavigationSession` for turn-by-turn
- Search: `CPListTemplate` search results fed by `pushSearchResults`; selection emits `searchResultSelected` back to JS, which computes the route and calls `startNavigation` (existing manager flow)
- Trip preview: `CPTrip` + `CPRouteChoice` built from `startNavigation` data; starting the session switches the map template into navigating mode with the maneuver panel populated from `updateNavigation`

### D5: Entitlements per build configuration

Per the pinned test contract:

- `ios/PolarisMaps/PolarisMaps.SimulatorCarPlay.entitlements` — base simulator entitlements **without** CarPlay keys; `scripts/resign-carplay-simulator-app.sh` merges `com.apple.developer.carplay-navigation` + `com.apple.developer.carplay-maps` at install time (Apple does not require approved provisioning on the simulator)
- `ios/PolarisMaps/PolarisMaps.Debug.entitlements` and release `PolarisMaps.entitlements` — no `carplay-maps` key (App Store submissions carrying it without approval are rejected); device enablement adds `com.apple.developer.carplay-navigation` plus profile regeneration when the user's Apple account has approval
- Build settings: `CODE_SIGN_ENTITLEMENTS[sdk=iphonesimulator*] = PolarisMaps/PolarisMaps.SimulatorCarPlay.entitlements` plus the existing signature-workaround script phases the test pins (`app-Simulated.xcent`, two “Remove signature files (Xcode workaround)” phases)

Note: the user opted to add entitlement keys; the test contract restricts _where_ they may appear. We honor the contract (simulator-time merging) and document the device-profile step in `docs/`.

### D6: Acceptance = existing unit tests + simulator smoke run

`carPlayXcodeConfig.test.ts` and `carPlayManager.test.ts` define the contract. Manual verification path: `pnpm prebuild && pnpm ios:pods`, then `pnpm carplay:sim` on a booted simulator using Apple's CarPlay simulator window.

## Risks / Trade-offs

- [MapLibre-in-CarPlay-scene rendering instability on some iOS versions] → Isolate all rendering behind one map-view wrapper class; documented snapshot-mode fallback
- [Second map instance doubles GPU/memory while connected] → Create the CarPlay map view lazily on scene connect, tear down on disconnect
- [Config-plugin pbxproj manipulation drift across Expo SDK upgrades] → Follow `withCloudStore` patterns exactly; the pinning unit test fails loudly on regressions
- [Apple review requires CarPlay navigation entitlement approval before distribution] → Keys are absent from store-facing entitlements by design; document the approval/profile step
- [Pre-existing Jest ESM failures may mask new test results] → Run targeted suites (`jest carPlay`) and report actual output

## Migration Plan

1. Add plugin + native sources; regenerate `ios/` via prebuild (user-approved destructive step) or apply plugin manually to the existing checked-in `ios/`
2. `pnpm typecheck && pnpm lint && targeted jest`
3. Verify on CarPlay simulator via `pnpm carplay:doctor` / `pnpm carplay:sim`
4. Rollback: revert the plugin registration in `app.json` and delete plugin files; no data migrations involved

## Open Questions

- Whether device builds in this environment use automatic signing such that adding `com.apple.developer.carplay-navigation` to Debug/Release entitlements can succeed without an approved profile (resolve when user regenerates provisioning)
