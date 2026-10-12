## Context

The navigation pipeline already has everything needed to compute and adopt a reroute: `routingService.computeRoute`/`reroute` return `ValhallaRoute`s, `navigationStore.replaceRoute`/`switchToAlternate` swap the active route, `trackingService` owns the live position/bearing, and `useTrafficEta` maintains a traffic-adjusted ETA. Today's `rerouteService.checkForReroute` only looks for congestion _ahead on the active route_ and then silently `replaceRoute()`s a single reroute, using `isReplacementRouteAcceptable(candidate, activeRoute.summary.durationSeconds)` — comparing the candidate's remaining duration against the original whole-trip duration.

Two consequences: the acceptance check is almost always satisfied once the trip is underway (so the "significantly faster" guarantee is false and the route can get slower), and the user is never offered a choice. Candidate routes are never requested, so "would a different route be faster?" is never asked.

Constraints: pure policy stays import-free for unit testing; the monitor is headless (also runs from `fixDrivenRefresh` on location fixes when the phone is locked); no new dependencies; do not edit generated `ios/`/`android/`.

## Goals / Non-Goals

**Goals:**

- Compare traffic-aware candidate routes against the current route's **remaining** time while navigating.
- Surface a dismissible suggestion when a candidate saves ≥ 120 s; never swap the route without consent.
- Cover the deviation case: re-evaluate regularly regardless of whether congestion is detected ahead.
- Keep the comparison cheap and anti-thrash (cooldown, single-flight, bounded cadence).

**Non-Goals:**

- Server-side routing or paid traffic APIs.
- Changing the deviation/off-route reroute (`trackingService`) — it stays an automatic safety behaviour.
- Perturbing polylines to fabricate alternatives.

## Decisions

### D1. Comparison is the unit of work; congestion is one trigger

`rerouteService` gains `evaluateFasterRoute()`. It runs when either (a) `congestionAhead` reports significant congestion on the active route ahead, or (b) a periodic full-compare interval (120 s) has elapsed since the last comparison. This keeps the existing route-scoped congestion signal meaningful (fast trigger) while guaranteeing comparison still happens after a deviation onto a heavier road, where congestion is not detected ahead on the new route.

- **Why not congestion-only**: the user's exact report — deviating onto a heavy road — produces no congestion-ahead signal on the new route, so congestion-only never fires.
- **Why not every 30 s unconditionally**: each comparison issues routing requests; 120 s bounds network cost off the free Valhalla endpoints while congestion still accelerates it.

### D2. Fair comparison uses remaining traffic-adjusted time

The current route's remaining time is derived from the traffic-adjusted ETA scaled by the remaining distance fraction:

`remainingFraction = remainingDistanceMeters / activeRoute.summary.distanceMeters`
`currentRemaining = trafficEtaSeconds != null ? trafficEtaSeconds * remainingFraction : etaSeconds`

Each candidate (computed from the current position, so its whole duration _is_ the remaining time) is scored with the shared `etaCalculator` (`extractRouteSegments` + `calculateTrafficETA`) using the same `trafficStore.normalizedSegments`, falling back to the engine duration when traffic coverage is too sparse (< 10% matched) or there is no traffic data.

- **Why not compare engine durations to `activeRoute.summary.durationSeconds`**: that is the original whole-trip duration, which is the bug that made the old check meaningless.
- **Why not engine durations alone**: online Valhalla has no traffic weights, so candidates would be scored free-flow while the current route is traffic-adjusted.

### D3. Suggestion state lives in the store; the service stays import-light

Add `fasterRouteSuggestion: { route, savingSeconds } | null` plus `suggestFasterRoute`, `acceptFasterRoute`, `dismissFasterRoute` to `navigationStore`. The service writes the suggestion; the banner reads it. `acceptFasterRoute` delegates to the existing `replaceRoute` so tracking/voice/HUD updates are identical to any reroute. The service exposes `noteFasterRouteDismissed()` to start the anti-thrash cooldown, since the service owns the cooldown clock (module state, like `lastCheckAt`).

- **Why the store and not a service event**: the banner must be reactive and survive re-renders; Zustand is the established reactive boundary.
- **Why a cooldown on dismiss**: a dismissed suggestion should not immediately reappear on the next tick.
- **Auto-expiry**: the service schedules a `SUGGESTION_TIMEOUT_MS` (20 s) timer when it surfaces a suggestion; on fire it dismisses only if the store still holds that exact route and starts the cooldown, so an ignored prompt does not linger yet an accepted one is not disturbed.

### D4. `rerouteCandidates` returns primary + alternates, degrading to one route

Add `rerouteCandidates(currentPosition, destination, costing, options)` to `routingService`. When there are no via points and the device is online, it requests `alternates: 2` from the online engine (which supports both alternatives and the origin `heading`); otherwise it falls back to the existing single `reroute()`. Offline native and MapKit cannot supply alternatives, and routing alternates with via points is not supported — both degrade to a single candidate rather than failing.

### D5. CarPlay surfaces the suggestion as a native navigation alert

`PolarisCarPlay.showFasterRouteAlert` presents a `CPNavigationAlert` ("Faster route" / "Save N min") with **Take it** (primary) and **Dismiss** (secondary) actions, mirroring `showIncidentAlert`'s alert plumbing. The actions emit `carPlayFasterRouteAccept` / `carPlayFasterRouteDismiss`; `carPlayManager` maps them to the store's `acceptFasterRoute` / `dismissFasterRoute` + `noteFasterRouteDismissed`. The manager syncs the alert from `state.fasterRouteSuggestion` on transitions and coexists with the existing rerouting alert via `fasterRouteAlertShown`/`rerouteAlertShown` guards. The Swift lives in `plugins/native/PolarisMaps/PolarisCarPlay.swift` (with the `-Bridging.m` extern) and is mirrored into `ios/PolarisMaps/` for local builds.

- **Why a native alert, not the map overlay**: CarPlay's guidance UI is template-driven; a navigation alert is the sanctioned, glanceable affordance and reuses the existing alert stack.
- **Phone companion**: the banner is also rendered in `app/(tabs)/navigation.tsx`'s CarPlay branch, so the phone shows it while the head unit is connected.

## Risks / Trade-offs

- **False or noisy suggestions** → 120 s minimum saving plus a dismiss cooldown; the comparison uses traffic-adjusted times on both sides.
- **Extra routing traffic** → bounded to at most one comparison per 120 s absent congestion, 30 s with congestion ahead; single-flight guard.
- **Comparison skew when traffic coverage is sparse** → fall back to engine durations when matched coverage < 10%.
- **Route longer than the current one but faster in time** → acceptable by design (time is the objective); the banner states the time saved.
- **Stale candidate accepted** → re-read the store after the async compute and abort if navigation ended or a suggestion already exists.

## Migration Plan

Pure in-memory Zustand state; no persistence or schema change. Rollback is reverting the change's commits; the removed `isReplacementRouteAcceptable` was only used by the reroute service and its unit test.

## Open Questions

- Should the suggestion auto-expire after a delay, or persist until accepted/dismissed? — **Resolved**: auto-expires after 20 s (`SUGGESTION_TIMEOUT_MS`), then cooldown.
- Should the banner also be surfaced on CarPlay? — **Resolved**: yes, as a native `CPNavigationAlert` plus the phone CarPlay-companion banner.
