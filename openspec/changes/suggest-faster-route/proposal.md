## Why

Polaris Maps never suggests a faster route based on traffic. During navigation the only traffic-aware behaviour is a `congestionAhead` check that silently `replaceRoute()`s the active route, and its acceptance rule (`newDuration < currentDuration * 1.25`) is weaker than the spec claims ("significantly faster"). It compares a candidate's duration against the _original whole-trip_ duration rather than the _remaining_ time, so it can adopt a route that is actually slower. Nothing computes alternative routes and offers a faster one, and the deviation reroute never pushes live traffic speeds into the engine. Users who deviate onto a heavier road are never offered a faster alternative.

This change replaces the silent auto-swap with a traffic-aware candidate comparison that surfaces a dismissible "Faster route — save X min" suggestion, and makes the suggestion the only way the route changes without the user's input.

## What Changes

- **Traffic-aware candidate comparison**: while navigating, periodically compute candidate routes (primary + engine alternatives) from the current position to the destination, preserving waypoints and route preferences, and push live P2P traffic speeds into the engine first.
- **Faster-route suggestion**: when the best candidate saves at least the minimum threshold (120 s) versus the current route's _remaining_ traffic-adjusted time, store a suggestion instead of replacing the route.
- **User-controlled switch**: a dismissible in-navigation banner with Accept/Dismiss; accepting promotes the candidate via the existing `replaceRoute` path, dismissing applies an anti-thrash cooldown.
- **Remove the silent auto-reroute**: the congestion-ahead check becomes one trigger for a comparison rather than a route swap; it no longer replaces the active route on its own.
- **Correct the acceptance rule**: the doc/implementation mismatch (`SIGNIFICANT_DELAY_FACTOR`, `isReplacementRouteAcceptable`) is replaced by `isSignificantlyFasterRoute` gated on a real saving.

## Capabilities

### New Capabilities

- `faster-route-suggestion`: traffic-aware candidate comparison, a dismissible in-navigation suggestion, and the accept/dismiss lifecycle.

### Modified Capabilities

- `congestion-reroute`: congestion ahead now triggers a comparison; the system no longer replaces the active route without the user's consent, and the anti-thrash guard governs suggestions.

## Impact

- **Traffic service**: `src/services/traffic/rerouteService.ts` (comparison + suggestion), `reroutePolicy.ts` (new policy constants/functions, remove inverted acceptance helper), `README.md`.
- **Routing**: `src/services/routing/routingService.ts` (new `rerouteCandidates` returning primary + alternates).
- **State**: `src/stores/navigationStore.ts` (`fasterRouteSuggestion` + actions, cleared across lifecycle transitions).
- **UI**: new `src/components/navigation/FasterRouteBanner.tsx`, mounted in `app/(tabs)/navigation.tsx`; exported from `src/components/navigation/index.ts`.
- **Tests**: `__tests__/unit/reroutePolicy.test.ts` updated; new store/suggestion tests; new `congestionAhead` remains covered.
