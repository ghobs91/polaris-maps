# CarPlay Integration

CarPlay dashboard for navigation state, search, and maneuver display.

## Overview

The CarPlay manager bridges the app's navigation and search capabilities to the CarPlay interface:

1. **Navigation sync** — mirrors the phone's active navigation view to CarPlay in real time:
   - Maneuver card: display text (verbal-first), live distance countdown (bucketed tracking updates applied as in-place `updateEstimates`, never card rebuilds) plus a proportional live time-to-turn countdown, next-turn "Then" row, lane-guidance strip as the symbol-only second maneuver, maneuver symbols + 17.4 metadata
   - Trip bar: traffic-scaled remaining ETA exactly like the phone's `EtaDisplay` (full-route TomTom ETA × remaining-distance fraction), published on start and every update, tinted green/orange/red by the phone's overall route traffic color
   - Route choice: phone route-preview summary (`"26 min · 13.8 mi"` via `formatDistance`) so units/order match the phone; start payload also carries per-maneuver banner text so the first live update is flicker-free
   - Map: phone's resolved map style JSON (follows the **car's** light/dark content style while attached, falling back to the phone theme; satellite preference, housenumbers hidden in navigation) pushed on connect and on theme/style changes; heading-up pitched follow camera, white-cased route line with live traffic-colored segments (index ranges from `carPlayTrafficRanges.ts`, built on the same GeoJSON matcher as the phone's `TrafficRouteLayer`), chevron puck, destination flag, unit-aware (`mph`/`km/h`) MUTCD speed-limit badge
   - Rerouting alert (`CPNavigationAlert`) shown/hidden only on `isRerouting`/`hasDeviated` transitions; teardown (`finishTrip`) only for sessions we started
   - Chrome: guidance banner tint matching the phone's `NextTurnBanner`, a mute navigation-bar button wired to the phone's `muted` state, and a route-overview button (`mapViewHost.showRouteOverview()`)
   - Lane guidance: native `CPLaneGuidance` (17.4+, via `linkedLaneGuidance`/`currentLaneGuidance`) built from the phone's lane model, with the rasterized lane strip as a fallback on older systems; highway exit labels (`exitNumber`/`exitBranch`) feed `CPManeuver.highwayExitLabel`
   - Arrival: when the phone declares arrival, CarPlay shows a "You have arrived" card; **Done** ends the trip on both surfaces
   - Incidents: the nearest crowd-reported incident ahead is announced once per incident via a transient navigation alert (reuses `findIncidentsAhead`, mirrors `IncidentAheadBanner`), and all active incidents are drawn as typed symbols on the map (mirrors `IncidentLayer`)
2. **Other CarPlay surfaces** — the Dashboard widget (iOS 13.4+) exposes Home/Work shortcut buttons that preview navigation to those favorites, and the instrument cluster (iOS 15.4+) mirrors the active navigation session's maneuvers with an idle caption. Scene roles + delegates are declared in `Info.plist` / `CarPlaySceneDelegate.swift`.
3. **Trip preview** — selecting a destination shows an Apple/Google-style preview with one `CPRouteChoice` per computed route (primary + up to two alternatives drawn grey on the map). Picking one and tapping **Go** emits `carPlayRouteStart`, and JS starts the matching phone-side navigation. An in-progress phone preview is mirrored on connect.
4. **Map interaction** — pan (rotary `panWith…` and touch `didUpdatePanGestureWithTranslation`), pinch-zoom, and rotate stop the follow camera and open the system panning interface; recentering (or dismissing the interface) snaps back to vehicle-follow. The recenter map-button icon reflects follow state.
5. **Search forwarding** — CarPlay search queries are routed through the unified search pipeline (`src/services/search/unifiedSearch.ts`) and results displayed in CarPlay list templates; an empty query lists saved places (Home/Work/pins); selecting a result offers **Start Navigation** or **Add Stop** (adds an intermediate waypoint to the active drive like the phone's add-destination panel, or starts a preview when idle)
6. **Lifecycle management** — handles CarPlay connect/disconnect events and template state transitions

Native sources of truth live in `plugins/native/PolarisMaps/` (`PolarisCarPlay.swift`, `PolarisCarPlayMapView.swift`) and are copied to `ios/PolarisMaps/` by `withCarPlay` on prebuild — keep both in sync.

## Files

| File                | Description                                                                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `carPlayManager.ts` | CarPlay integration manager. Syncs navigation state (maneuvers, ETA) to CarPlay templates, forwards search queries through the unified search pipeline, and handles connect/disconnect lifecycle. |

## Related Files

- [`src/services/search/unifiedSearch.ts`](../search/unifiedSearch.ts) — Search pipeline used for CarPlay queries
- [`src/stores/navigationStore.ts`](../../stores/navigationStore.ts) — Active route, maneuvers, ETA
- [`src/services/routing/routingService.ts`](../routing/routingService.ts) — Valhalla routing for CarPlay directions
