## 1. Setup

- [x] 1.1 Add `expo-task-manager` via `npx expo install expo-task-manager` (SDK 57-matched version)
- [x] 1.2 Update `app.json`: add `ios.infoPlist.UIBackgroundModes: ["location"]`; update `NSLocationWhenInUseUsageDescription` and `NSLocationAlwaysAndWhenInUseUsageDescription` copy to explicitly cover turn-by-turn guidance in the background

## 2. Extract tracking pipeline (no behavior change yet)

- [x] 2.1 Create `src/services/navigation/trackingService.ts`: move the GPS-processing logic from `app/(tabs)/navigation.tsx` verbatim into `startTracking(route)` / `processFix(location)` / `stopTracking()` (snap-to-route, DR anchor + no-backwards-jump rule, off-route counter/threshold, reroute trigger, step advancement, ETA updates); expose DR anchor state for the interpolation loop
- [x] 2.2 Create `src/stores/navigationTrackingStore.ts` with `navPosition`, `navBearing`, `distanceToTurn` and have `trackingService` write to it
- [x] 2.3 Add unit tests for `trackingService`: happy-path fix processing, off-route boundary/counter behavior, reroute trigger + replaceRoute, premature-step-advance guard (`gpsSegmentIndexRef` semantics), DR no-backwards-jump rule, speed clamping
- [x] 2.4 Run new unit tests plus existing route-snap/navigation tests: `pnpm test -- __tests__/unit` and confirm no regressions in related suites

## 3. Switch navigation screen onto shared pipeline

- [x] 3.1 Refactor `app/(tabs)/navigation.tsx` effect: remove inline pipeline; keep the 60fps RAF interpolation loop reading anchors from `trackingService` and publish position/bearing via `navigationTrackingStore`
- [x] 3.2 Wire foreground fallback: retain `watchPositionAsync` path used when background permission is unavailable; both paths call `trackingService.processFix`
- [ ] 3.3 Verify on iOS simulator/device: foreground guidance behaves identically to before refactor (position glide, step banners, ETA countdown, haptics, TTS)

## 4. Background session lifecycle

- [x] 4.1 Create `src/services/navigation/backgroundLocationTask.ts`: register `TaskManager.defineTask(BACKGROUND_LOCATION_TASK, ...)` at module load; handler exits early if `isNavigating === false`, otherwise forwards fixes to `trackingService.processFix`
- [x] 4.2 Implement session start: on `startNavigation`, check/request background permission per design D4 (explainer → `requestBackgroundPermissionsAsync` when undetermined; skip prompt if previously denied), then `Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, { accuracy: BestForNavigation, pausesUpdatesAutomatically: false, showsBackgroundLocationIndicator: true })`; fall back to foreground watcher on denial
- [x] 4.3 Implement session stop: on `stopNavigation` (and route completion/cancel paths), call `Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK)` and `stopTracking()`
- [x] 4.4 Guard task registration/session calls to iOS only (Platform check) so Android behavior is unchanged
- [x] 4.5 Add integration test for lifecycle: start → session started with expected options; stop → session stopped; headless event while not navigating → early exit

## 5. Native rebuild & device verification

- [ ] 5.1 Run `pnpm prebuild && pnpm ios:pods && pnpm ios:device` to regenerate native project with `UIBackgroundModes` (requires user go-ahead since prebuild wipes `ios/`)
- [ ] 5.2 Device verification: start navigation, lock phone — confirm continued position advance, Live Activity updates, TTS prompts; background app mid-route — confirm reroute fires after deviation; end navigation — confirm blue indicator disappears and location sessions stop
- [ ] 5.3 Confirm permission UX: first-run explainer + OS prompt at navigation start; denied path falls back to foreground-only without re-prompting

## 6. Quality gates

- [x] 6.1 Run `pnpm lint`, `pnpm format:check`, `pnpm typecheck`
- [x] 6.2 Run full relevant test suites (`pnpm test`) and report actual results (pre-existing failures documented as known issue)
