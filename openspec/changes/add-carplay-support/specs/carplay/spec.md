## ADDED Requirements

### Requirement: CarPlay native scene lifecycle

The iOS app SHALL register a CarPlay template application scene (`CPTemplateApplicationSceneSessionRoleApplication`) with a `CarPlaySceneDelegate`, and the AppDelegate SHALL route CarPlay-role scene sessions to that delegate while keeping phone sessions on the existing `SceneDelegate`. The generated `ios/` configuration SHALL be reproducible via an Expo config plugin so it survives `expo prebuild --clean`.

#### Scenario: Phone app launches normally

- **WHEN** the app launches on an iPhone without CarPlay connected
- **THEN** the existing phone `SceneDelegate` window and React Native root load unchanged, with no CarPlay UI presented

#### Scenario: CarPlay head unit connects

- **WHEN** a CarPlay connection is established (device or Apple's CarPlay simulator)
- **THEN** `CarPlaySceneDelegate` receives the template application scene, hosts a map template in the CarPlay window, and notifies the native module of the connection

#### Scenario: Prebuild regeneration

- **WHEN** `expo prebuild --clean` regenerates the `ios/` directory
- **THEN** the CarPlay source files, Info.plist scene registration, entitlements split, and Xcode project entries are all restored by the config plugin

### Requirement: PolarisCarPlay native module contract

The native module `PolarisCarPlay` SHALL implement exactly the methods declared in `src/native/carplay/NativePolarisCarPlay.ts` — `updateNavigation`, `startNavigation`, `endNavigation`, `pushSearchResults`, `updateMapCenter`, `isConnected` — and SHALL emit the events `carPlayConnected`, `carPlayDisconnected`, `searchQuery`, and `searchResultSelected` consumed by `carPlayManager.ts`.

#### Scenario: JS queries connection state before scene attaches

- **WHEN** `isConnected()` is called before any CarPlay scene has connected or after disconnect
- **THEN** it resolves to `false` without touching a nil interface controller

#### Scenario: Navigation state sync while driving

- **WHEN** `updateNavigation` is called with active maneuver data during an active navigation session
- **THEN** the CarPlay maneuver panel (current instruction, distance, ETA, next maneuver) updates to reflect the payload

#### Scenario: Navigation ends

- **WHEN** `endNavigation` is called (or `updateNavigation` reports `isNavigating: false`)
- **THEN** the active navigation session on the map template is cancelled and the maneuver panel is dismissed

### Requirement: Scene-state buffering

Because the CarPlay scene can connect before React Native attaches the module listener, the native module SHALL buffer scene state (`pendingInterfaceController`, `isSceneConnected`) and replay/attach it when the bridge attaches, including resolving pending `isConnected()` calls.

#### Scenario: CarPlay connects before RN module attaches

- **WHEN** the CarPlay scene connects while the app is still loading React
- **THEN** the interface controller is buffered; once the module attaches, `attachPendingSceneIfNeeded()` publishes the connection and emits `carPlayConnected`

### Requirement: Live map rendering on CarPlay

The CarPlay display SHALL render a live vector map using MapLibre Native hosted in the CarPlay window, styled consistently with the phone map via the local loopback tile server. The map SHALL display the active route polyline and follow the vehicle position.

#### Scenario: Route drawn on CarPlay map

- **WHEN** navigation starts via `startNavigation` with an encoded polyline
- **THEN** the decoded route geometry renders as a line overlay on the CarPlay map with the camera fitted to overview

#### Scenario: Camera follows position

- **WHEN** `updateMapCenter` delivers a new position/heading while navigating
- **THEN** the CarPlay map camera tracks the position

#### Scenario: CarPlay disconnects mid-navigation

- **WHEN** the CarPlay session ends while the map view exists
- **THEN** the CarPlay map instance is torn down and resources are released; phone-side navigation state is unaffected

### Requirement: CarPlay search

The CarPlay search flow SHALL present a list template whose results are provided by `pushSearchResults`; selecting a result SHALL emit `searchResultSelected` to JavaScript, and typed queries SHALL be forwarded as `searchQuery`.

#### Scenario: User searches on the head unit

- **WHEN** the user enters a query in the CarPlay search template
- **THEN** `searchQuery` is emitted to JS and results pushed back appear as selectable list items

#### Scenario: User selects a result

- **WHEN** a result is selected on the head unit
- **THEN** `searchResultSelected` is emitted with name/lat/lng and the JS layer begins trip preview/navigation

### Requirement: Trip preview and start navigation

The module SHALL construct a `CPTrip` with route choices from `startNavigation` data and begin a navigation session upon confirmation, switching the map template into navigating mode.

#### Scenario: Starting navigation from CarPlay

- **WHEN** `startNavigation` is called after a result selection
- **THEN** a trip preview appears and the confirmed route starts a navigation session showing maneuvers

### Requirement: Entitlements per build configuration

Entitlements SHALL be split per configuration such that simulator builds receive `PolarisMaps.SimulatorCarPlay.entitlements` (without CarPlay keys; merged at resign time by the simulator scripts), Debug/Release entitlements contain no unapproved `com.apple.developer.carplay-maps` key, and build settings set `CODE_SIGN_ENTITLEMENTS[sdk=iphonesimulator*]` accordingly.

#### Scenario: App Store-facing entitlement hygiene

- **WHEN** a Release build's entitlements are inspected
- **THEN** no `com.apple.developer.carplay-maps` key is present

#### Scenario: Simulator install with CarPlay enabled

- **WHEN** `pnpm carplay:sim` installs and re-signs the app for the simulator
- **THEN** the resigned binary carries both CarPlay entitlement keys and passes `pnpm carplay:doctor`
