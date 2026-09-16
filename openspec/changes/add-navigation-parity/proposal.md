## Why

Polaris Maps ships turn-by-turn navigation but is missing five features users expect from Apple/Google Maps, so the P2P alternative feels unfinished: route alternatives are never requested or shown, navigation never ends or advances on its own at a destination, voice guidance is a single prompt per maneuver that stops when the phone locks, guidance is drive-only, and the safety HUD lacks current speed and offline-resilient lane/speed-limit data. This change closes those gaps for the iOS ship target.

## What Changes

- **Route alternatives**: request Valhalla alternates, render them on the map and as cards with time/distance/delay, let the user pick one before driving and switch to one during active navigation, preserving waypoints and route preferences.
- **Arrival flow**: detect arrival at each waypoint and at the destination using GPS proximity plus route progress; auto-advance legs (configurable); show an arrival summary; auto-end navigation (configurable); announce arrival by voice and haptic.
- **Voice guidance**: advance-distance announcement ladder ("in 1 mile", "in 400 meters", …), an initial "starting navigation" prompt, spoken reroute and off-route notifications, in-navigation mute and repeat controls, and a background audio session so prompts play while the screen is locked. Stays on device TTS (expo-speech), no paid voice service.
- **All-mode navigation**: guided walking and (where costing/data exist) cycling turn-by-turn reusing the existing guidance UI; transit step-through from the itinerary; mode-appropriate UI where automotive-only widgets (lane guidance, speed limit, speed HUD) are hidden for non-driving modes.
- **Navigation safety HUD**: current speed display; speed-limit change/over-speed alert; preserve lane guidance and speed limits on offline Valhalla and MapKit fallback routes by restoring the dropped native field mappings; search along the route corridor; a live steps list during navigation.

No existing spec requirements change; all five capabilities are new.

## Capabilities

### New Capabilities

- `route-alternatives`: compute, display, select, and switch route alternatives before and during navigation.
- `navigation-arrival-flow`: waypoint and destination arrival detection, leg auto-advance, arrival summary, auto-end, and arrival announcement.
- `voice-guidance`: advance-distance announcement ladder, start/reroute/off-route prompts, in-navigation mute/repeat, background audio.
- `all-mode-navigation`: guided walk/bicycle turn-by-turn and transit step-through with mode-appropriate UI.
- `navigation-safety-hud`: current speed, speed-limit alerts, offline/fallback lane and speed-limit preservation, along-route search, and in-navigation steps list.

### Modified Capabilities

- None.

## Impact

- **Routing**: `src/services/routing/routingService.ts` (`computeRoute` options/alternates), `src/native/valhalla/{index.ts,NativePolarisValhalla.ts}`, `src/native/mapkit/{index.ts,NativePolarisMapKit.ts}`.
- **Native (iOS)**: `plugins/native/PolarisMaps/PolarisValhalla.swift` and `PolarisMapKit.swift` (canonical source copied by `plugins/withValhalla.js`), mirrored in `ios/PolarisMaps/`; `app.json` `infoPlist.UIBackgroundModes` (add `audio`).
- **State**: `src/stores/navigationStore.ts` (alternates, arrival, mode), `src/stores/settingsStore.ts` (auto-advance/auto-end/mute config), `src/stores/transitStore.ts` (step-through).
- **UI**: `app/(tabs)/navigation.tsx`, `src/components/navigation/*` (HUD, NextTurnBanner, LaneGuidance, SpeedLimitSign, new alternatives/steps/arrival components), `src/components/map/{FloatingSearchPanel,TransportModeSelector,TransitDirectionsPanel}.tsx`.
- **Services**: `src/services/tts/ttsService.ts`, `src/services/navigation/trackingService.ts` (`getGpsSpeed`), new speed-alert and along-route-search helpers.
