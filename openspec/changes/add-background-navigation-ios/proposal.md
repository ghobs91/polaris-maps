## Why

Turn-by-turn navigation currently stops working when the user backgrounds Polaris or locks their iPhone: iOS suspends the app and the JS-driven GPS loop in `app/(tabs)/navigation.tsx` halts, so guidance, ETA, rerouting, and the Live Activity freeze mid-route. Apple Maps, Google Maps, and every other navigation app continue guiding in this situation; this is table-stakes behavior for a navigation product.

## What Changes

- Add `UIBackgroundModes: ["location"]` to the iOS Info.plist via `app.json`, so an active background-location session keeps the app alive while navigating
- Extract the turn-by-turn GPS-processing pipeline (snap-to-route, dead-reckoning anchor updates, off-route detection/rerouting, maneuver step advancement, ETA/remaining-distance updates) out of the `NavigationScreen` React effect into a shared tracking module under `src/services/navigation/`
- Move live nav position/bearing state out of component-local `useState` into a small subscribable store (`src/stores/navigationTrackingStore.ts` or similar) so headless code can update it while the UI is backgrounded
- Start a headless background location task (via `expo-task-manager` + `expo-location.startLocationUpdatesAsync`) when navigation starts, with `BestForNavigation` accuracy, `pausesUpdatesAutomatically: false`, and the iOS background-location indicator enabled; stop it when navigation ends
- Request iOS background location permission ("Always") at navigation start when not yet granted; degrade gracefully to foreground-only if the user declines
- The foreground `watchPositionAsync` watcher and the background task both feed the same shared tracking module, so behavior is identical whether the app is foregrounded, backgrounded, or locked
- No changes to route calculation, Valhalla integration, CarPlay, or Live Activity contracts — those consumers read from the same stores as today

iOS only for this change. Android already holds `ACCESS_BACKGROUND_LOCATION`; its foreground-service wiring is deferred.

## Capabilities

### New Capabilities

- `background-navigation`: Continuous turn-by-turn guidance while the iOS app is backgrounded or the screen is locked — background location session lifecycle tied to navigation state, shared GPS-tracking pipeline usable headless, background location permission handling, and graceful fallback to foreground-only tracking

### Modified Capabilities

<!-- None — no existing specs directory; no prior spec-level requirements exist to modify. -->

## Impact

- **New files**: shared navigation tracking module (`src/services/navigation/trackingService.ts`), live-position store (`src/stores/navigationTrackingStore.ts`), background task registration module (e.g. `src/services/navigation/backgroundLocationTask.ts`)
- **Modified**: `app/(tabs)/navigation.tsx` (consume shared pipeline instead of inline effect logic), `src/stores/navigationStore.ts` (hook background-session start/stop into `startNavigation`/`stopNavigation`), `app.json` (`UIBackgroundModes`, expo-location plugin options, possibly updated usage strings)
- **New dependency**: `expo-task-manager` (required by `expo-location.startLocationUpdatesAsync`) — must be version-matched to Expo SDK 57
- **Native**: requires a new native build after `app.json` change (`expo prebuild` regenerates `ios/`); no hand edits to generated files
- **Permissions UX**: users see an additional iOS "Allow Always" location prompt at first background-capable navigation start; declining falls back to current foreground-only behavior
- **Testing**: unit tests for the extracted tracking module (happy path, off-route/reroute boundary, step advancement) and integration test for session lifecycle per `.specify/memory/constitution.md`
