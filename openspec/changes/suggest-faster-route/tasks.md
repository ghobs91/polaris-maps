## 1. Policy

- [x] 1.1 Replace `isReplacementRouteAcceptable`/`SIGNIFICANT_DELAY_FACTOR` in `src/services/traffic/reroutePolicy.ts` with `isSignificantlyFasterRoute(candidate, current, minSavingSeconds = 120)` and add `FULL_ROUTE_COMPARE_INTERVAL_MS` and `MIN_FASTER_ROUTE_SAVING_SECONDS`
- [x] 1.2 Update `__tests__/unit/reroutePolicy.test.ts` for the new helper (faster/slower/boundary/zero-current)

## 2. Routing

- [x] 2.1 Add `rerouteCandidates()` to `src/services/routing/routingService.ts` returning primary + engine alternates when online with no via points, degrading to a single `reroute()`
- [x] 2.2 Unit-test `rerouteCandidates` request shape and single-route fallback

## 3. Store

- [x] 3.1 Add `fasterRouteSuggestion`, `suggestFasterRoute`, `acceptFasterRoute`, `dismissFasterRoute` to `src/stores/navigationStore.ts`
- [x] 3.2 Clear the suggestion across `startNavigation`, `stopNavigation`, `replaceRoute`, `switchToAlternate`, `addWaypointAndReplaceRoute`
- [x] 3.3 Add store tests for suggest/accept/dismiss and lifecycle clearing

## 4. Traffic service

- [x] 4.1 Rewrite `rerouteService.evaluateFasterRoute()` to compute traffic-aware candidates, score remaining time, and set the suggestion instead of replacing the route
- [x] 4.2 Trigger comparison on congestion ahead OR the periodic full-compare interval; keep single-flight, cooldown, GPS-less deferral, and route-preference forwarding
- [x] 4.3 Export `noteFasterRouteDismissed()` and reset cooldown/comparison clocks on stop

## 5. UI

- [x] 5.1 Add `src/components/navigation/FasterRouteBanner.tsx` (saving text, Accept/Dismiss, accessibility, haptics) and export from the navigation barrel
- [x] 5.2 Mount the banner in `app/(tabs)/navigation.tsx` above the turn banner
- [x] 5.3 Integration-test the banner: hidden with no suggestion, shows saving, Accept promotes the route, Dismiss clears and cools down
- [x] 5.4 Auto-expire the suggestion after `SUGGESTION_TIMEOUT_MS` (20 s) and start the cooldown, no-op when already accepted
- [x] 5.5 Render the banner in the CarPlay-companion phone view

## 6. CarPlay

- [x] 6.1 Add `showFasterRouteAlert` to `NativePolarisCarPlay.ts` and the `src/native/carplay` wrapper
- [x] 6.2 Add the native `CPNavigationAlert` (Take it / Dismiss) in `plugins/native/PolarisMaps/PolarisCarPlay.swift` + `-Bridging.m`, emitting `carPlayFasterRouteAccept`/`carPlayFasterRouteDismiss`
- [x] 6.3 Mirror the Swift/bridging changes into `ios/PolarisMaps/`
- [x] 6.4 Sync the alert from `state.fasterRouteSuggestion` in `carPlayManager`, wire both events to the store, and guard coexistence with the rerouting alert
- [ ] 6.5 Verify the CarPlay alert on a head unit / CarPlay simulator `pnpm carplay:sim` (requires a native build)

## 7. Documentation

- [x] 7.1 Update `src/services/traffic/README.md` (behaviour, constants, file table)
- [x] 7.2 Run `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, and the relevant Jest suites; report actual results
