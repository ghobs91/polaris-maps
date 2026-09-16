## Why

The app's first-run surfaces and preferences are effectively missing. Onboarding and its versioned consent flow exist but nothing routes to them, so the constitution's mandatory granular consent and just-in-time permission requirements are violated in practice. The place-details screen is registered but unreachable, so local reviews, peer edits, attestation, and nearby imagery are invisible. The units preference and map-style selection have no working UI path, so they are frozen at their defaults.

## What Changes

- Route first launch into the existing onboarding flow before the map, apply its granular consent choices through `consent.ts`, and make consent completion the gate that is actually read.
- Gate traffic-probe and imagery collectors on consent, stopping them when consent is withdrawn. Cross-references `activate-p2p-core` for probe-collection ownership.
- Add a Settings section to review and change granular consent, and re-run consent when its version changes.
- Make the primary place card navigate to the existing `/poi/[id]` place-details screen so local reviews, peer edits, attestation, and nearby imagery are reachable; eliminate the orphaned-screen condition.
- Add a Settings control for units and apply it consistently to distance, ETA, and speed displays; persist the map style/layer selection; make gated surfaces follow the in-app theme instead of only the OS scheme.
- Verify and remove dead code, and correct stale service READMEs.

## Capabilities

### New Capabilities

- `first-run-onboarding-consent`: first-launch gating, granular consent collection/application/versioning, consent-gated collectors, just-in-time permissions, and a Settings entry to review or change consent.
- `place-details-surface`: navigation from the primary place card to the existing place-details screen and reachability of local reviews, peer edits, attestation, and nearby imagery.
- `map-and-unit-preferences`: a Settings units preference applied to distance/ETA/speed displays, persisted map style/layer selection, and in-app-theme-governed gated surfaces.

### Modified Capabilities

None. `openspec/specs/` is empty, so all three capabilities are introduced as new specs.

## Impact

- **Screens/routing**: `app/_layout.tsx` (first-run gate), `app/onboarding/index.tsx`, `app/(tabs)/_layout.tsx`, `app/settings/index.tsx`.
- **Components**: `src/components/map/POIInfoCard.tsx` (details entry point), `src/components/settings/SettingsContent.tsx` (units plus consent), `src/components/regions/RegionGate.tsx` (theme).
- **Services/stores**: `src/services/identity/consent.ts`, `src/services/traffic/probeCollector.ts`, `src/services/imagery/uploadService.ts`, `src/stores/settingsStore.ts`, `src/stores/mapStore.ts`, `src/utils/units.ts`.
- **Dead code / docs**: candidates enumerated in `design.md`; `src/services/traffic/README.md`, `src/services/routing/README.md`, `src/services/search/README.md`, `src/services/poi/README.md`.
- **Tests**: `__tests__/unit`, `__tests__/integration`.
- **Cross-references**: `activate-p2p-core` (probe-collection coordinator and lifecycle), `broaden-traffic-and-media-sources` (map detail overlays: `MapLayerToggle`, `LocationActionPanel`, `PlaceDetailEmbed`).
