# CarPlay Integration

CarPlay dashboard for navigation state, search, and maneuver display.

## Overview

The CarPlay manager bridges the app's navigation and search capabilities to the CarPlay interface:

1. **Navigation sync** — mirrors the phone's active navigation view to CarPlay in real time:
   - Maneuver card: display text (verbal-first), live distance countdown (bucketed tracking updates applied as in-place `updateEstimates`, never card rebuilds), next-turn "Then" row, lane-guidance strip as the symbol-only second maneuver, maneuver symbols + 17.4 metadata
   - Trip bar: real travel estimates (distance + ETA) published on start and every update
   - Map: heading-up pitched follow camera, white-cased route line with live traffic-colored segments (index ranges from `carPlayTrafficRanges.ts`, built on the same GeoJSON matcher as the phone's `TrafficRouteLayer`), chevron puck, destination flag, unit-aware (`mph`/`km/h`) MUTCD speed-limit badge
   - Rerouting alert (`CPNavigationAlert`) shown/hidden only on `isRerouting`/`hasDeviated` transitions; teardown (`finishTrip`) only for sessions we started
2. **Search forwarding** — CarPlay search queries are routed through the unified search pipeline (`src/services/search/unifiedSearch.ts`) and results displayed in CarPlay list templates
3. **Lifecycle management** — handles CarPlay connect/disconnect events and template state transitions

Native sources of truth live in `plugins/native/PolarisMaps/` (`PolarisCarPlay.swift`, `PolarisCarPlayMapView.swift`) and are copied to `ios/PolarisMaps/` by `withCarPlay` on prebuild — keep both in sync.

## Files

| File                | Description                                                                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `carPlayManager.ts` | CarPlay integration manager. Syncs navigation state (maneuvers, ETA) to CarPlay templates, forwards search queries through the unified search pipeline, and handles connect/disconnect lifecycle. |

## Related Files

- [`src/services/search/unifiedSearch.ts`](../search/unifiedSearch.ts) — Search pipeline used for CarPlay queries
- [`src/stores/navigationStore.ts`](../../stores/navigationStore.ts) — Active route, maneuvers, ETA
- [`src/services/routing/routingService.ts`](../routing/routingService.ts) — Valhalla routing for CarPlay directions
