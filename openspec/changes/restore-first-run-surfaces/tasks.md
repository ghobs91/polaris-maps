## 1. First-run gating and consent flow

- [x] 1.1 Add a first-run gate in `app/_layout.tsx` that renders the onboarding route before the tab stack when `hasCompletedConsent()` is false, so `(tabs)` effects do not start first
- [x] 1.2 Make consent completion (`applyConsentChoices`) the signal the gate reads and remove the unused `onboarding_complete` write in `app/onboarding/index.tsx` (or read it explicitly) so no write-only flag remains
- [x] 1.3 Confirm `app/onboarding/index.tsx` performs no network requests and that declining choices plus skipping region download reaches the map
- [x] 1.4 Add `getConsentChoices()` to `src/services/identity/consent.ts` for pre-filling re-consent, keeping `applyConsentChoices` as the only version writer
- [ ] 1.5 Add integration tests: fresh launch shows onboarding; completed launch skips it; all-declined completes offline to a usable map

## 2. Consent-gated collectors

- [x] 2.1 Guard the `_layout.tsx` traffic P2P/probe startup on consent completion and `trafficTelemetryEnabled`, and subscribe to `settingsStore` so toggling consent starts/stops collection (coordinator ownership stays with `activate-p2p-core`)
- [x] 2.2 Gate imagery upload/publish on `imagerySharingEnabled` in `src/services/imagery/uploadService.ts`
- [x] 2.3 Gate POI edit, review, and attestation submission on `poiContributionsEnabled` (auto-seed is already gated)
- [x] 2.4 Add unit tests asserting each collector stays idle when its consent choice is off and stops when it is turned off at runtime

## 3. Settings consent and re-consent

- [x] 3.1 Add a granular consent group to `src/components/settings/SettingsContent.tsx` bound to `settingsStore.permissions` with independent toggles for location, traffic telemetry, POI contributions, and imagery
- [x] 3.2 Surface a review/re-run consent affordance in Settings that reopens the onboarding consent step
- [x] 3.3 On launch, detect a stale or missing consent version and route to the consent step before normal use
- [x] 3.4 Add tests: Settings reflects onboarding choices; changing a choice persists and gates behavior; a version bump forces re-consent

## 4. Place details reachability

- [x] 4.1 Add a details/reviews affordance to `src/components/map/POIInfoCard.tsx` that navigates to `/poi/[id]`
- [x] 4.2 Implement resolution of a map-selected place to the identifier `app/poi/[id].tsx` loads, covering OSM, Overture, and synthetic map-selection places (resolve to `places.uuid` or extend the screen with a coordinate/name fallback)
- [x] 4.3 Show the local review count or preview on the primary place UI from `reviewService`
- [x] 4.4 Verify the details screen renders pending peer edits, the attestation action, and the nearby imagery strip for the resolved place, with an actionable message when resolution fails
- [ ] 4.5 Add integration tests for card-to-details navigation, return-to-map selection, and each reachable section
- [x] 4.6 Audit the root stack registrations and record that every registered screen now has an in-app caller (`poiStore` no longer orphaned)

## 5. Units preference

- [x] 5.1 Add a metric/imperial units control to `SettingsContent.tsx` bound to `useMetric`/`setUseMetric`
- [x] 5.2 Make `src/utils/units.ts:formatDistance` honor the units preference (explicit parameter or store read) and remove the module-level locale-derived `useImperial` constant
- [x] 5.3 Update `src/components/navigation/SpeedLimitSign.tsx` to use `formatSpeed(mph, useMetric)` instead of its inline conversion
- [x] 5.4 Consolidate the duplicated local distance formatters in `FloatingSearchPanel.tsx`, `TransitDirectionsPanel.tsx`, and `LocationActionPanel.tsx` onto the shared helper so units apply
- [x] 5.5 Confirm `carPlayManager.ts` route summaries and speed limits match the shared preference
- [x] 5.6 Add unit tests for metric/imperial output including the feet/miles and metres/kilometres boundaries

## 6. Map style persistence and theme

- [x] 6.1 Persist `mapStyle` in `src/stores/mapStore.ts` (load at init, save in `setMapStyle`) alongside the existing traffic layer persistence
- [x] 6.2 Ensure all persisted layer toggles are restored on launch and confirm satellite plus traffic survive a relaunch
- [x] 6.3 Replace `useColorScheme()` with `useTheme()` in `src/components/regions/RegionGate.tsx`, and audit `GeofabrikTreePicker.tsx` for the same drift
- [x] 6.4 Add tests: style and layer restore after re-init; gated surface colors follow the in-app theme over the OS scheme

## 7. Dead-code and documentation cleanup

- [x] 7.1 Re-verify every candidate with an import search (excluding the file itself and generated artifacts) and record the result before deleting anything
- [x] 7.2 Remove verified-unreferenced code: `routeHistoryService.ts`, `ManeuverList.tsx`, `TrafficLegend.tsx`, `MapControls.tsx`, `SkeletonScreen.tsx` plus its barrel export and tests, `poiService.searchPlaces`, `transitStopFetcher.ts`, `wakuBridge.ts`
- [x] 7.3 Flag `MapLayerToggle.tsx`, `LocationActionPanel.tsx`, and `PlaceDetailEmbed.tsx` as deferred to `broaden-traffic-and-media-sources` (do not delete here) and note the overlap
  - Note: all three remain in the tree; `broaden-traffic-and-media-sources` owns their removal (`MapLayerToggle`, `LocationActionPanel`) or replacement (`PlaceDetailEmbed`).
- [x] 7.4 Correct stale claims in `src/services/traffic/README.md`, `src/services/routing/README.md`, `src/services/search/README.md`, and `src/services/poi/README.md`
- [x] 7.5 Run `pnpm typecheck`, `pnpm lint`, and `pnpm format:check` after removals and fix fallout

## 8. Verification and reporting

- [x] 8.1 Run the unit and integration suites for the changed areas and report actual results, noting the repository's known pre-existing failures
- [ ] 8.2 Manual simulator pass: fresh install onboarding, consent gating, Settings consent changes, place-details navigation, units switching, map-style persistence, and in-app-theme gating
- [x] 8.3 Run `openspec validate restore-first-run-surfaces` and resolve any spec-format errors
