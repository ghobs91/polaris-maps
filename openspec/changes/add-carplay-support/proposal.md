## Why

Polaris Maps is a turn-by-turn navigation app, and CarPlay support is table stakes for in-car use: drivers currently have no way to run Polaris navigation or search from their car's head unit. The TypeScript integration layer (`src/services/carplay/carPlayManager.ts`, `src/native/carplay/`) already exists and calls a native module named `PolarisCarPlay` — but no such native module exists, so the feature is inert at runtime.

## What Changes

- Add the native iOS `PolarisCarPlay` TurboModule (`PolarisCarPlay.swift` + `.m` bridge header entry) implementing the existing TS spec: `updateNavigation`, `startNavigation`, `endNavigation`, `pushSearchResults`, `updateMapCenter`, `isConnected`, plus event emission for `carPlayConnected`, `carPlayDisconnected`, `searchQuery`, `searchResultSelected`
- Add CarPlay scene lifecycle: `CPTemplateApplicationSceneDelegate`-based scene configuration in `Info.plist` (`CPTemplateApplicationSceneSessionRoleApplication`) alongside the existing phone `SceneDelegate`
- Build the CarPlay template UI natively: map template with full live map rendering (second MapLibre render target fed by the local `PolarisTileServer`), search list templates, trip preview / start-navigation flow, and turn-by-turn maneuver panel
- Add CarPlay entitlements (`com.apple.developer.carplay-maps`, `com.apple.developer.carplay-navigation`) to `PolarisMaps.entitlements`
- No changes to the existing TS layer contract; `carPlayManager.ts` works unchanged once native lands

## Capabilities

### New Capabilities

- `carplay`: Native iOS CarPlay integration — scene setup, entitlements, PolarisCarPlay module, live map template, search templates, and navigation session bridging to the app's navigation/search state

### Modified Capabilities

<!-- None — no existing spec-level requirements change. -->

## Impact

- **New native files**: `ios/PolarisMaps/PolarisCarPlay.swift`, `ios/PolarisMaps/PolarisCarPlay.m`, supporting scene delegate code
- **Modified**: `ios/PolarisMaps/PolarisMaps.entitlements`, `ios/PolarisMaps/Info.plist`, `ios/PolarisMaps/PolarisMaps-Bridging-Header.h`, Xcode project file (new source references)
- **Existing code consumed as-is**: `src/native/carplay/*`, `src/services/carplay/carPlayManager.ts`, `src/stores/navigationStore.ts`, `src/services/search/unifiedSearch.ts`, `src/services/routing/routingService.ts`, `PolarisTileServer` (loopback tile feed)
- **Provisioning**: requires Apple-side regeneration of provisioning profiles with the CarPlay navigation entitlement before device/TestFlight builds work
- **Testing**: unit tests for the manager already exist? (to be verified during implementation); new tests needed per constitution for any new public functions; simulator verification via existing `scripts/install-carplay-simulator.sh` / `pnpm carplay:sim`
