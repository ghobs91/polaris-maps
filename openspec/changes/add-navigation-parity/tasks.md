## 1. Shared Foundations

- [x] 1.1 Add navigation settings to `src/stores/settingsStore.ts`: `navigationAutoAdvanceLegs` (default on), `navigationAutoEnd` (default on), and voice prompt ladder/alert config, with persistence alongside existing settings
- [x] 1.2 Add a `NavigationMode` derivation from `CostingModel` and a mode-capability map (automotive-only widgets) in `src/models/route.ts` or a new `src/utils/navigationMode.ts`
- [x] 1.3 Add `muted` (in-navigation) state and arrival state fields to `src/stores/navigationStore.ts` without removing existing fields
- [x] 1.4 Add unit tests for settings defaults, mode derivation, and the capability map

## 2. Route Alternatives

- [x] 2.1 Thread an `alternates` request (max 2) through `computeRoute` call sites in `FloatingSearchPanel.tsx`, `LocationActionPanel.tsx`, `navigation.tsx`, and `AddDestinationPanel.tsx`, preserving waypoints and route preferences
- [x] 2.2 Ensure offline/fallback paths degrade to a single route when alternatives are unsupported and never render an empty list
- [x] 2.3 Render alternative polylines on the map with the selected route emphasized
- [x] 2.4 Add an alternatives card list showing duration, distance, and delay vs. the fastest route
- [x] 2.5 Implement preview selection that promotes an alternative to primary and updates ETA/distance
- [x] 2.6 Implement mid-navigation switching that replaces the active route, re-threads waypoints and `currentLegIndex`, and restarts tracking
- [x] 2.7 Clear stale alternatives after recompute or switch
- [ ] 2.8 Add unit tests for alternate computation threading and integration tests for preview selection and mid-navigation switching with a waypoint

## 3. Navigation Arrival Flow

- [x] 3.1 Implement arrival detection combining GPS radius and route progress with consecutive-fix debouncing in a new `src/services/navigation/arrivalService.ts`
- [x] 3.2 Wire waypoint arrival detection into the tracking loop in `app/(tabs)/navigation.tsx`
- [x] 3.3 Implement leg auto-advance or arrival prompt based on `navigationAutoAdvanceLegs`
- [x] 3.4 Implement destination arrival detection and declaration
- [x] 3.5 Build an arrival summary component (destination name, elapsed time, total distance)
- [x] 3.6 Implement auto-end (summary dismiss or delay) based on `navigationAutoEnd`
- [x] 3.7 Announce arrival via TTS and success haptic
- [ ] 3.8 Add unit tests for arrival heuristics (radius+progress, near-pass false positive, GPS loss) and integration tests for auto-advance and auto-end

## 4. Voice Guidance

- [x] 4.1 Implement the advance-distance announcement ladder with per-maneuver per-band dedupe in `src/services/tts/ttsService.ts`
- [x] 4.2 Reset ladder state on reroute and new maneuver; retain short-range step-change announcement
- [x] 4.3 Add a "starting navigation" prompt on navigation start
- [x] 4.4 Add spoken off-route and reroute-complete notifications on state edges
- [x] 4.5 Add in-navigation mute/unmute and repeat controls to the HUD, gating `ttsService` without mutating the global voice setting
- [x] 4.6 Harden TTS interruption handling (single in-flight utterance, dedupe reset on done/error)
- [x] 4.7 Enable a background audio session coordinated with the existing background location session, released on navigation end
- [ ] 4.8 Add unit tests for ladder band selection and dedupe, and integration tests for mute, repeat, and off-route/reroute prompts

## 5. All-Mode Navigation

- [x] 5.1 Add bicycle to `TransportModeSelector.tsx` and make walk startable as guided navigation
- [x] 5.2 Route walk/bicycle through the guidance shell with the corresponding costing and tracking
- [x] 5.3 Gate lane guidance, speed-limit sign, and speed HUD off for pedestrian/bicycle and transit
- [x] 5.4 Implement transit step-through from `transitStore` itineraries with transit-appropriate presentation
- [ ] 5.5 Add unit tests for mode gating and integration tests for walk guidance, bicycle guidance, and transit step-through

## 6. Navigation Safety HUD

- [x] 6.1 Display current speed from `getGpsSpeed()` in the user's units, hidden when unavailable
- [x] 6.2 Detect speed-limit changes and implement debounced/hysteretic over-speed alerts
- [x] 6.3 Implement along-route corridor search reusing distance-to-polyline utilities and surface results as stops
- [x] 6.4 Add an in-navigation steps list highlighting the current maneuver, updating on route replacement
- [ ] 6.5 Add unit tests for speed/limit alert thresholds and corridor ranking, and integration tests for the steps list and along-route search

## 7. Native Platform Mapping

- [ ] 7.1 Extend the Swift maneuver mapping in `plugins/native/PolarisMaps/PolarisValhalla.swift` to emit `speed_limit` and `lanes`
- [ ] 7.2 Extend `plugins/native/PolarisMaps/PolarisMapKit.swift` to emit `street_names`, `verbal_post_transition`, and any available speed/lane data
- [ ] 7.3 Mirror the Swift changes into `ios/PolarisMaps/` for local builds and confirm `plugins/withValhalla.js` copies them
- [ ] 7.4 Extend `NativePolarisValhalla.ts` and `NativePolarisMapKit.ts` types and map the new fields in `src/native/valhalla/index.ts` and `src/native/mapkit/index.ts` using `parseLaneGuidance`
- [ ] 7.5 Add `audio` to `UIBackgroundModes` in `app.json` and document the background audio usage
- [ ] 7.6 Add unit tests asserting native route payloads with lanes/speed limits map through, and absent payloads omit the fields

## 8. Verification And Documentation

- [x] 8.1 Run `pnpm typecheck`, `pnpm lint`, and `pnpm format:check`
- [x] 8.2 Run the most relevant Jest suites and report actual results (the suite has known pre-existing failures)
- [ ] 8.3 Verify on-device lock-screen voice prompts and background location coexistence
- [x] 8.4 Update service READMEs and note the Open Questions resolved during implementation
