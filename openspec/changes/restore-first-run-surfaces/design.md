## Context

Three first-run surfaces exist in code but are unreachable or frozen:

- `app/onboarding/index.tsx` is registered in `app/_layout.tsx` but nothing navigates to it. It writes an `onboarding_complete` MMKV flag that is never read, and it calls `applyConsentChoices` from `src/services/identity/consent.ts`, which is otherwise unused. `hasCompletedConsent()`/`resetConsent()` have no callers. The constitution requires granular, explicit consent before any collection (location, traffic telemetry, imagery, business edits independently togglable) and just-in-time permissions with explanations.
- `app/poi/[id].tsx` is registered but no code navigates to it. It is the only consumer of `src/stores/poiStore.ts` and the only place local reviews (`reviewService`), pending peer edits, proof-of-presence attestation, and nearby street imagery are surfaced. The map's real place UI, `src/components/map/POIInfoCard.tsx`, only shows a transient TripAdvisor rating.
- `src/stores/settingsStore.ts` exposes `useMetric`/`setUseMetric`; `SpeedLimitSign` and `carPlayManager` read them, but no Settings UI calls the setter. Separately, `src/utils/units.ts:formatDistance` keys off a module-level `useImperial` derived from device locale, so even if `useMetric` were set, most distance displays would ignore it. `src/stores/mapStore.ts` persists only `trafficLayerVisible`; `mapStyle` resets on relaunch. `src/components/regions/RegionGate.tsx` uses the OS scheme directly instead of `ThemeContext`.

Constraint: the app is offline-first. First-run flow must be fully local, must not depend on network, and declining consent must not block the map or offline region use. The constitution forbids dead code and requires tests for user-facing features and public functions.

## Goals / Non-Goals

**Goals:**

- A first launch that reaches onboarding, collects versioned granular consent, and applies it where collectors run.
- Consent review/change in Settings and re-consent on version change.
- A reachable place-details screen from the primary place UI, with local reviews/edits/attestation/imagery visible.
- A units preference that actually controls distance/ETA/speed displays, persisted map style/layers, and in-app-theme-driven gated surfaces.
- Verified removal of dead code and corrected documentation.

**Non-Goals:**

- Redesigning onboarding copy/visuals beyond what is needed for correctness.
- New P2P message types or changes to the traffic mesh internals (owned by `activate-p2p-core`).
- Removing or refactoring `MapLayerToggle`, `LocationActionPanel`, or `PlaceDetailEmbed` (owned by `broaden-traffic-and-media-sources`).
- Adding analytics, remote consent records, or accounts.

## Decisions

### D1. Gate first run at the root layout, not via a deep-link screen

Add a gate inside `RootLayoutInner` that evaluates `hasCompletedConsent()` synchronously from MMKV before rendering the tab stack, and renders the onboarding route when consent is incomplete. Keep `onboarding/index` registered. Do not rely on a redirect effect, which would let `(tabs)` mount and start effects (`initTrafficP2P`, RegionGate location request) before the redirect fires.

Alternative considered: add `app/index.tsx` that redirects. Rejected because it still lets the tab tree resolve and because there is currently no index route (the tabs index is the default), so introducing one adds routing ambiguity.

`onboarding/index.tsx` writes `onboarding_complete`, which nothing reads. Make consent completion (`applyConsentChoices`) the single source of truth for the gate and delete the unused flag write, or keep a derived helper if a separate onboarding-done signal is later needed. (Constitution: no dead code.)

### D2. Consent versioning and re-consent

`consent.ts` already stores `privacy_consent_version` and compares it to `CURRENT_CONSENT_VERSION`. The gate uses `hasCompletedConsent()`; a mismatch (including no record, e.g. existing installs after upgrade) sends the user through the consent step. Add `getConsentChoices()` that reads the current `settingsStore.permissions` so re-consent pre-fills prior choices, but require an explicit confirm action to write the new version. Do not auto-upgrade the version on read.

Trade-off: existing installs without a consent record see the consent screen once. This is intentional and privacy-safe; the copy should state that.

### D3. Consent versus OS permission

Consent choices are independent of OS permissions and are never inferred from a granted permission. OS permissions are requested just-in-time with an explanation at the point of use (location on the map/navigation; camera/photo for imagery capture). Onboarding may request location with an explainer, but the user can decline it and still complete the flow. Declining an OS permission must not be treated as consent, and opting out of imagery/telemetry means those permissions are never requested.

### D4. Consent gates collectors, with live reaction

- `trafficTelemetryEnabled` gates probe collection. `probeCollector.ts` already checks `settingsStore.permissions` before collecting; `activate-p2p-core` adds the lifecycle coordinator in `_layout.tsx`. This change makes the coordinator start only when consent is complete and the choice is on, and subscribes to `settingsStore` so toggling consent starts/stops collection without relaunch.
- `imagerySharingEnabled` gates imagery upload/publish (capture itself may still save locally).
- `poiContributionsEnabled` gates edits, reviews, attestation, and Overture auto-seed.
- `locationEnabled` gates location subscriptions.

`_layout.tsx` must not call `initTrafficP2P` before consent is established; sequence it after the gate or guard it on consent.

### D5. Persistence

Use the existing MMKV-backed `storage` service. `settingsStore` already persists `useMetric` and `permissions`; no new store is needed. Extend `mapStore` to load `mapStyle` at init and save it in `setMapStyle`, alongside the existing `trafficLayerVisible` persistence (same storage key or a sibling key). Transit visibility, if persisted, follows the same pattern.

### D6. Units application

`useMetric` exists but most displays ignore it. Make unit formatting explicit and store-driven:

- Introduce a pure helper (for example `formatDistance(meters, useMetric)`) or a small hook that reads `useMetric`; remove the module-level `useImperial` constant, which cannot react to preference changes.
- `SpeedLimitSign.tsx` currently converts manually; route it through `formatSpeed(mph, useMetric)`.
- `carPlayManager.ts` already reads `useMetric`; keep it consistent with the shared helper.
- `FloatingSearchPanel.tsx`, `TransitDirectionsPanel.tsx`, and `LocationActionPanel.tsx` define local `formatDistance`/`formatDuration` duplicates; consolidate distance formatting to the shared helper so units apply (duration is unit-agnostic and may stay local or be shared).

Boundary behavior must stay explicit and tested: imperial shows feet below 0.1 mi and miles above; metric shows metres below 1 km and kilometres above.

### D7. Place details reachability and identifier resolution

`POIInfoCard` holds an `OsmPoi` whose `id` may be a positive OSM id, a synthetic map-selection id, or a negative Overture id. `app/poi/[id].tsx` loads a local `Place` by `uuid` via `getPlaceById`. These are not the same namespace, so the entry point must resolve a selected place to the identifier the screen expects. Options, in preference order: resolve the selected place to its stored `places.uuid` (by source id or coordinates/name), or extend the details screen to accept a lat/lng + name fallback and load or construct the place. The unpalatable option, passing the raw `OsmPoi.id` and rendering a blank screen, is rejected.

Add a "More details"/"Reviews" affordance to `POIInfoCard` that navigates to `/poi/[id]`, and surface the local review count so reviews are discoverable. The details screen already renders reviews, pending edits, attestation, and the imagery strip, so no new sections are required beyond verifying they render for the resolved place.

### D8. Dead-code verification before deletion

No file is removed on the strength of this document alone. Before deleting each candidate, re-run an import search (excluding the candidate's own file and generated artifacts) and record the result:

- Verified unreferenced (remove): `src/services/routing/routeHistoryService.ts`, `src/components/navigation/ManeuverList.tsx`, `src/components/map/TrafficLegend.tsx`, `src/components/map/MapControls.tsx`, `src/components/common/SkeletonScreen.tsx` (plus its barrel export and any test), `searchPlaces` in `src/services/poi/poiService.ts`, `src/services/transit/transitStopFetcher.ts`, `src/services/traffic/wakuBridge.ts`.
- Deferred to `broaden-traffic-and-media-sources` (do not delete here; flag the overlap): `src/components/map/MapLayerToggle.tsx`, `src/components/map/LocationActionPanel.tsx`, `src/components/map/PlaceDetailEmbed.tsx`. `PlaceDetailEmbed` is referenced only by `__tests__/integration/placeDetailEmbed.test.tsx`; `MapLayerToggle` is superseded by the map-type selector in `FloatingSearchPanel.tsx`; `LocationActionPanel` overlaps route-preview UI in `FloatingSearchPanel.tsx`. Whether they are replaced or removed depends on that change's direction.
- If removing a component, remove its now-unused test in the same commit and confirm `pnpm typecheck` still resolves the barrel exports.

### D9. Documentation corrections

Update the four READMEs to match shipped behavior: `traffic/README.md` (Waku bridge removed), `routing/README.md` (remove route-history and `ManeuverList` claims once removed), `search/README.md` (reconcile with actual sources/exports), `poi/README.md` (reflect `PlaceDetailEmbed` status and that `app/poi/` is reachable or queued for the `broaden-traffic-and-media-sources` change).

### D10. Rollback

All changes are additive keys plus wiring. `resetConsent()` already clears the consent record, which re-triggers onboarding locally. Reverting the change commits restores prior behavior; no data migration is required because consent keys and the map-style key are new and ignored by prior code. If the details entry point causes regressions, the affordance can be hidden without removing the screen or store.

## Risks / Trade-offs

- Existing users get a one-time consent prompt after upgrade because no consent record exists. Mitigation: pre-fill prior `settingsStore.permissions` choices, keep the prompt short, and state that data collection is off until confirmed.
- Making `formatDistance` store-driven changes many call sites and snapshot/unit expectations. Mitigation: keep a pure function with an explicit parameter, update call sites in one commit, and add boundary tests.
- The map-selected-place identifier mismatch could yield empty details screens. Mitigation: implement resolution first, add a fallback that shows an actionable message rather than a blank screen, and cover OSM, Overture, and synthetic map-selection places in tests.
- Gating `initTrafficP2P` on consent could regress the `activate-p2p-core` coordinator if both touch `_layout.tsx`. Mitigation: make this change own the consent condition and `activate-p2p-core` own the coordinator; sequence the two changes or coordinate the edit.
- Removing dead code could collide with `broaden-traffic-and-media-sources`. Mitigation: D8's deferred list and a pre-deletion import check.
- Offline first-run could attempt a network-dependent step. Mitigation: onboarding performs no network requests; region download is already optional and skippable.

## Migration Plan

1. Land consent gating and onboarding routing behind the existing consent service; verify a fresh install and an upgraded install (no consent record) both reach the flow.
2. Wire collector gating and Settings consent controls; verify toggles stop/start collection.
3. Add the place-details entry point and identifier resolution; verify reachability and that `poiStore` is no longer orphaned.
4. Add units UI and make formatting store-driven; persist map style; switch gated surfaces to `ThemeContext`.
5. Perform dead-code verification and removal, then README corrections, as separate atomic commits.
6. Verify with `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, and the relevant Jest suites, then a simulator pass.

Rollback: revert the offending commit(s). No server or stored-data migration exists; `resetConsent()` re-triggers onboarding locally if needed.

## Open Questions

- Resolve a map-selected place by stored `places.uuid` lookup, or extend `app/poi/[id].tsx` to accept coordinates + name and load/build the place on demand? This determines how much of the details screen needs a non-uuid path.
- Should an upgraded install with no consent record always re-consent, or only when `CURRENT_CONSENT_VERSION` is explicitly raised? The current design assumes always re-consent once.
- Should the units preference also change routing `directions_options.units` (currently hardcoded `kilometers`), or only display formatting?
- Should a map-style control also live in Settings, or is the existing `FloatingSearchPanel` map-type selector sufficient once persistence works?
- Do `MapLayerToggle`, `LocationActionPanel`, and `PlaceDetailEmbed` get reworked or deleted by `broaden-traffic-and-media-sources`, and in what order should that change land relative to this one?
- Is transit layer visibility intended to persist like traffic, or to reset each launch?
