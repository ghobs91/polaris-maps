# Implementation Plan: Real-Time Traffic Flow Overlay with Dynamic ETA

**Branch**: `002-traffic-flow-eta` | **Date**: 2026-03-10 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/002-traffic-flow-eta/spec.md`

## Summary

Add real-time traffic visualization and traffic-adjusted ETAs to Polaris Maps. Road segments on the map will be color-coded by congestion level (green/yellow/orange/red) using data from TomTom Traffic Flow API, HERE Traffic Flow API, and existing P2P Waku probes — merged with confidence-weighted averaging. A pure `calculateTrafficETA()` function will compute traffic-adjusted ETAs by matching route segments to traffic data via coordinate proximity, falling back to free-flow speed where data is missing. The ETA recalculates on every traffic refresh cycle during navigation.

## Technical Context

**Language/Version**: TypeScript ~5.6 (strict mode, no `any` in new code)
**Primary Dependencies**: React Native 0.76 + Expo 52, @maplibre/maplibre-react-native 10.x, Zustand 5.x, expo-location
**Storage**: expo-sqlite (existing), react-native-mmkv (existing), in-memory Zustand stores
**Testing**: Jest 29 + jest-expo + @testing-library/react-native; benchmark via jest.benchmark.config.js
**Target Platform**: iOS + Android (Expo managed + bare native modules)
**Project Type**: Mobile app (React Native / Expo Router)
**Performance Goals**: 60fps map rendering during pan/zoom; traffic color update visible within 3s of pan; ETA recalc within 5s of traffic refresh
**Constraints**: <300MB memory during typical usage; API calls debounced; all network I/O off main thread; fail silently when APIs unavailable
**Scale/Scope**: Single mobile app; ~50 screens; new feature adds ~8 new/modified files across models, services, components, stores, and utils

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

### I. Code Quality — PASS

- All new modules have single responsibility: fetcher per API source, normalizer, merger, ETA calculator, overlay component, legend component.
- No dead code introduced. Existing placeholder `TrafficOverlay.tsx` will be replaced, not left alongside.
- Public API boundaries: services expose typed functions; stores expose typed selectors; components are self-contained.

### II. Testing Standards — PASS (with requirements)

- `calculateTrafficETA()` is a pure function: fully unit-testable with happy path, edge cases (no traffic data, partial coverage, all stopped), and boundary conditions.
- Each external API normalizer will have unit tests with fixture data.
- Merger/aggregator logic will have unit tests covering single-source, multi-source, and conflict resolution.
- Integration test: overlay renders correct colors given mock traffic state in store.
- Benchmark test required for ETA calculation with large segment arrays (performance-sensitive path per Constitution IV).

### III. UX Consistency — PASS

- Traffic colors use existing design tokens (`colors.traffic.*` from theme.ts).
- Legend follows existing glass/surface design system.
- ETA display extends existing `EtaDisplay` component pattern.
- Error states: silent fallback (no traffic = normal map), consistent with Constitution requirement for actionable guidance (here: no error to communicate, just graceful degradation).

### IV. Performance Requirements — PASS (with requirements)

- Traffic overlay uses MapLibre LineLayer (GPU-rendered), not JS-side drawing. Must maintain 60fps.
- API fetching debounced (500ms) and off main thread.
- ETA calculation is O(n) single-pass — benchmark test required.
- Memory: traffic segments stored in Zustand; bounded by viewport area (max ~200 segments at typical zoom).

### V. Atomic Commits — PASS

- Feature decomposes into independent commits: model types, API fetchers, normalizer, merger, ETA function, overlay component, legend, ETA display integration, navigation integration.

### Security & Privacy — PASS

- API keys stored in `.env`, accessed via `react-native-dotenv`. Never hardcoded.
- No user location data sent to external APIs — only bounding box coordinates (viewport corners) are sent to TomTom/HERE.
- Existing consent system (`trafficTelemetryEnabled`) governs P2P probe sharing; external API fetching does not require additional consent since it retrieves public traffic data.

## Project Structure

### Documentation (this feature)

```text
specs/002-traffic-flow-eta/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── traffic-api.md   # External API contract documentation
└── tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── models/
│   └── traffic.ts                          # MODIFY — add NormalizedTrafficSegment, ETARouteSegment interfaces
├── services/
│   └── traffic/
│       ├── trafficAggregator.ts            # EXISTING — P2P probe aggregation (unchanged)
│       ├── probeCollector.ts               # EXISTING — probe collection (unchanged)
│       ├── rerouteService.ts               # EXISTING — reroute logic (unchanged)
│       ├── topicManager.ts                 # EXISTING — Waku topic subscriptions (unchanged)
│       ├── wakuBridge.ts                   # EXISTING — Waku bridge (unchanged)
│       ├── tomtomFetcher.ts                # NEW — TomTom Traffic Flow API fetcher + normalizer
│       ├── hereFetcher.ts                  # NEW — HERE Traffic Flow API fetcher + normalizer
│       ├── trafficMerger.ts                # NEW — merge multi-source segments with confidence weighting
│       └── trafficFlowService.ts           # NEW — orchestrator: fetch, normalize, merge, update store
├── utils/
│   └── etaCalculator.ts                    # NEW — pure calculateTrafficETA() function
├── stores/
│   └── trafficStore.ts                     # MODIFY — add normalizedSegments slice for external API data
├── components/
│   ├── map/
│   │   ├── TrafficOverlay.tsx              # MODIFY — replace placeholder with LineLayer rendering
│   │   └── TrafficLegend.tsx               # NEW — legend component
│   └── navigation/
│       └── EtaDisplay.tsx                  # MODIFY — show traffic-adjusted ETA
└── constants/
    └── config.ts                           # MODIFY — add TOMTOM_API_KEY, HERE_API_KEY env references

__tests__/
├── unit/
│   ├── etaCalculator.test.ts              # NEW — pure function unit tests
│   ├── tomtomFetcher.test.ts              # NEW — normalizer tests with fixtures
│   ├── hereFetcher.test.ts                # NEW — normalizer tests with fixtures
│   └── trafficMerger.test.ts              # NEW — merger logic tests
├── integration/
│   └── trafficOverlay.test.tsx            # NEW — overlay renders correct colors
└── benchmark/
    └── etaCalculator.bench.ts             # NEW — benchmark with large segment arrays
```

**Structure Decision**: Follows existing `src/` layout. New traffic service files sit alongside existing ones in `src/services/traffic/`. The pure ETA calculator goes in `src/utils/` to enforce separation from I/O. No new top-level directories needed.

## Complexity Tracking

> No Constitution violations. No complexity justifications required.

## Constitution Re-Check (Post-Design)

_Re-evaluated after Phase 0 research and Phase 1 design artifacts are complete._

### I. Code Quality — PASS

- Each new file has a single responsibility: `tomtomFetcher` (fetch + normalize TomTom), `hereFetcher` (fetch + normalize HERE), `trafficMerger` (merge sources), `trafficFlowService` (orchestrate), `etaCalculator` (pure ETA math), `TrafficOverlay` (render), `TrafficLegend` (legend UI).
- Data model defines clear public types (`NormalizedTrafficSegment`, `ETARouteSegment`, `ETAResult`) with no leaky abstractions.
- No code duplication: shared normalization output type used by all three data sources.

### II. Testing Standards — PASS

- Research resolved: `calculateTrafficETA()` pure function design ensures deterministic unit tests.
- Contract: `contracts/traffic-api.md` documents full request/response schema for TomTom and HERE, enabling fixture-based normalizer tests.
- Data model provides explicit validation rules (speed ranges, confidence bounds) that translate directly to test assertions.
- Benchmark: ETA calculation over O(n) route segments with geohash-indexed traffic lookup is performance-sensitive → benchmark test specified in project structure.

### III. UX Consistency — PASS

- Data model specifies congestion thresholds matching existing `colors.traffic.*` tokens from theme.ts.
- `TrafficLegend` component will follow existing glass design system.
- `EtaDisplay` extended with `trafficEtaSeconds` / `freeFlowEtaSeconds` — no new UI paradigm, just additional data.
- Silent degradation: when no traffic data available, UI unchanged from current behavior.

### IV. Performance — PASS

- Research confirmed: MapLibre `LineLayer` with `['step']` expression is GPU-rendered, preserving 60fps.
- HERE bbox query returns all data in one call (efficient). TomTom grid sampling capped at 25 points.
- 800ms debounce + 60s periodic refresh prevents over-fetching.
- ETA: single O(n) pass with geohash6 spatial index. Benchmark test required.
- Memory bounded: max ~200 normalized segments per viewport update.

### V. Atomic Commits — PASS

- Project structure shows clear decomposition into 8+ independent files, each forming a natural commit boundary.
- No file mixes concerns: types separate from fetchers, fetchers separate from merger, merger separate from UI.

### Security & Privacy — PASS

- Research confirmed: only viewport bounding box (not user location) sent to external APIs.
- API keys via `react-native-dotenv` `@env` module — build-time injection, not runtime exposure.
- `.env` excluded from git; `.env.example` committed.
- No new permissions required beyond existing location access.

**Result: All gates PASS. No violations. Ready for Phase 2 task generation.**
