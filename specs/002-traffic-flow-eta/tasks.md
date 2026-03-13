# Tasks: Real-Time Traffic Flow Overlay with Dynamic ETA

**Input**: Design documents from `/specs/002-traffic-flow-eta/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Tests are included as specified in the constitution (II. Testing Standards) and plan.md (benchmark for ETA calculator, unit tests for all public functions).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Environment configuration and dependency installation for external traffic API integration

- [x] T001 Install `react-native-dotenv` dependency and add Babel plugin to `babel.config.js`
- [x] T002 [P] Create `.env.example` with `TOMTOM_API_KEY` and `HERE_API_KEY` placeholders at project root
- [x] T003 [P] Add `.env` to `.gitignore` if not already present
- [x] T004 [P] Create TypeScript type declaration for `@env` module in `src/types/env.d.ts`
- [x] T005 Add `TOMTOM_API_KEY` and `HERE_API_KEY` env references to `src/constants/config.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared model types, store modifications, and utility functions that ALL user stories depend on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T006 Add `NormalizedTrafficSegment` interface to `src/models/traffic.ts` per data-model.md
- [x] T007 [P] Add `ETARouteSegment` interface to `src/models/traffic.ts` per data-model.md
- [x] T008 [P] Add `ETAResult` interface to `src/models/traffic.ts` per data-model.md
- [x] T009 [P] Add `CongestionThresholds` constants to `src/models/traffic.ts` per data-model.md
- [x] T010 Add `normalizedSegments`, `isExternalFetchLoading`, `lastExternalFetchAt` state and actions to `src/stores/trafficStore.ts` per data-model.md
- [x] T011 Add `trafficEtaSeconds`, `freeFlowEtaSeconds`, `trafficMatchRatio`, and `updateTrafficEta` action to `src/stores/navigationStore.ts` per data-model.md

**Checkpoint**: Foundation ready — model types and store slices available for all user stories

---

## Phase 3: User Story 1 — View Traffic Congestion on the Map (Priority: P1) 🎯 MVP

**Goal**: Display color-coded road segments on the map using traffic data from a single external source (TomTom), with debounced viewport-triggered fetching and a visible legend

**Independent Test**: Open the map in an area with traffic data and verify road segments display correct colors (green/yellow/orange/red). Pan/zoom and confirm traffic updates within 3 seconds. Verify legend is visible.

### Tests for User Story 1

- [x] T012 [P] [US1] Unit test for TomTom normalizer with fixture data in `__tests__/unit/tomtomFetcher.test.ts`
- [x] T013 [P] [US1] Integration test for TrafficOverlay rendering correct colors given mock traffic state in `__tests__/integration/trafficOverlay.test.tsx`

### Implementation for User Story 1

- [x] T014 [P] [US1] Implement TomTom Traffic Flow API fetcher and normalizer in `src/services/traffic/tomtomFetcher.ts` — includes grid sampling logic (4×4 at zoom 14, 3×3 at zoom ≤12, 5×5 at zoom ≥16, max 25 points), `Promise.allSettled()` parallel requests, and `TomTomFlowResponse → NormalizedTrafficSegment` normalization per contracts/traffic-api.md
- [x] T015 [P] [US1] Implement traffic flow orchestrator in `src/services/traffic/trafficFlowService.ts` — viewport-change listener with 800ms debounce, calls fetcher(s), updates `trafficStore.normalizedSegments`. Initially wired to TomTom only; merger integration deferred to US4
- [x] T016 [US1] Replace placeholder CircleLayer with LineLayer rendering in `src/components/map/TrafficOverlay.tsx` — GeoJSON FeatureCollection of LineString features from `trafficStore.normalizedSegments`, `lineColor` driven by `['step', ['get', 'congestionRatio'], '#991B1B', 0.25, '#FF3B30', 0.50, '#FF9500', 0.75, '#34C759']`, zoom-responsive `lineWidth`, `lineCap: 'round'`, `lineJoin: 'round'`
- [x] T017 [P] [US1] Create traffic legend component in `src/components/map/TrafficLegend.tsx` — displays four color bands with labels (Free Flow, Slow, Congested, Stopped), uses existing `colors.traffic.*` tokens from theme.ts, follows glass design system
- [x] T018 [US1] Wire `trafficFlowService` to map viewport changes in `src/components/map/TrafficOverlay.tsx` — subscribe to `mapStore.viewport` changes, trigger debounced fetch, handle loading state from `trafficStore.isExternalFetchLoading`

**Checkpoint**: Traffic overlay with color-coded roads and legend visible on map. Pan/zoom triggers data refresh. Silent fallback when API unavailable.

---

## Phase 4: User Story 2 — Traffic-Adjusted Route ETA (Priority: P2)

**Goal**: Compute and display a traffic-adjusted ETA for active routes by matching route geometry to traffic segments using coordinate proximity

**Independent Test**: Compute a route through segments with known traffic data and verify the displayed ETA is higher than the free-flow estimate by the expected amount. Verify fallback to free-flow when no traffic data is available.

### Tests for User Story 2

- [x] T019 [P] [US2] Unit tests for `calculateTrafficETA()` in `__tests__/unit/etaCalculator.test.ts` — cover: full traffic coverage, partial coverage, no coverage, mixed-source data, very short segments (<10m), all-stopped traffic, empty route
- [x] T020 [P] [US2] Benchmark test for `calculateTrafficETA()` with large segment arrays (1000+ segments) in `__tests__/benchmark/etaCalculator.bench.ts`

### Implementation for User Story 2

- [x] T021 [P] [US2] Implement `extractRouteSegments()` helper in `src/utils/etaCalculator.ts` — decode `ValhallaRoute.geometry` via existing `decodePolyline()`, compute Haversine distances between consecutive coordinate pairs, assign `freeFlowSpeedKmh` from road class defaults, return `ETARouteSegment[]`
- [x] T022 [US2] Implement `calculateTrafficETA()` pure function in `src/utils/etaCalculator.ts` — O(n) single pass over route segments, match each segment midpoint to nearest `NormalizedTrafficSegment` via geohash6 spatial index (using existing `src/utils/geohash.ts`), 50m Haversine threshold, fall back to free-flow speed, return `ETAResult` with `totalSeconds`, `freeFlowTotalSeconds`, `matchedSegmentCount`, and formatted strings
- [x] T023 [P] [US2] Implement `formatETA()` helper in `src/utils/etaCalculator.ts` — format seconds as "X min" (< 60 min) or "X hr Y min" (≥ 60 min)
- [x] T024 [US2] Modify `src/components/navigation/EtaDisplay.tsx` to show traffic-adjusted ETA — read `trafficEtaSeconds` and `freeFlowEtaSeconds` from `navigationStore`, display traffic ETA prominently with free-flow ETA as secondary comparison, handle null traffic ETA gracefully (show free-flow only)
- [x] T025 [US2] Wire ETA calculation on route activation — when `navigationStore.activeRoute` is set, call `extractRouteSegments()` + `calculateTrafficETA()` with current `trafficStore.normalizedSegments`, call `navigationStore.updateTrafficEta()` with results

**Checkpoint**: Active routes show traffic-adjusted ETA. Free-flow fallback works when no traffic data. ETA calculator passes all unit tests and benchmark.

---

## Phase 5: User Story 3 — Dynamic ETA Updates During Navigation (Priority: P3)

**Goal**: Automatically recalculate and update the displayed ETA on every traffic data refresh cycle during active navigation, without user action

**Independent Test**: Start navigation on a route, simulate a traffic data refresh with changed congestion on upcoming segments, and verify the displayed ETA changes accordingly. Verify no flickering when conditions unchanged.

### Implementation for User Story 3

- [x] T026 [US3] Add 60-second periodic traffic refresh timer to `src/services/traffic/trafficFlowService.ts` — active only when `navigationStore.isNavigating` is true, fetches traffic for route bounding box (from `ValhallaRoute.boundingBox`), clears on navigation end
- [x] T027 [US3] Implement ETA recalculation on traffic data change — subscribe to `trafficStore.normalizedSegments` changes in the navigation flow, recalculate ETA for remaining route segments only (trim already-passed segments based on current position), update `navigationStore.updateTrafficEta()`, skip re-render if ETA unchanged (within ±5s tolerance)
- [x] T028 [US3] Handle traffic data unavailability during navigation in `src/services/traffic/trafficFlowService.ts` — when refresh fails, keep previous `normalizedSegments` in store, log warning, continue with stale data until next successful refresh

**Checkpoint**: ETA updates dynamically during navigation. No flicker on unchanged conditions. Graceful fallback on API failures.

---

## Phase 6: User Story 4 — Multi-Source Traffic Data Aggregation (Priority: P4)

**Goal**: Fetch traffic from both TomTom and HERE APIs in parallel, normalize both, and merge with P2P probe data using confidence-weighted averaging for the most accurate traffic picture

**Independent Test**: Call aggregation logic with mock TomTom, HERE, and P2P data overlapping on same segments and verify merged output uses confidence-weighted averaging. Test single-source fallback.

### Tests for User Story 4

- [x] T029 [P] [US4] Unit test for HERE normalizer with fixture data in `__tests__/unit/hereFetcher.test.ts`
- [x] T030 [P] [US4] Unit tests for traffic merger logic in `__tests__/unit/trafficMerger.test.ts` — cover: single source passthrough, two-source overlap merge, three-source merge (TomTom + HERE + P2P), non-overlapping segments, stale data rejection

### Implementation for User Story 4

- [x] T031 [P] [US4] Implement HERE Traffic Flow API fetcher and normalizer in `src/services/traffic/hereFetcher.ts` — single bbox request, `locationReferencing=shape`, flatten links to individual `NormalizedTrafficSegment` per contracts/traffic-api.md, extend bbox to route bounding box when route active
- [x] T032 [P] [US4] Implement P2P `AggregatedTrafficState → NormalizedTrafficSegment` converter in `src/services/traffic/trafficMerger.ts` — look up road class defaults for free-flow speed, confidence = `min(1.0, sampleCount / 5) × 0.7`, use geohash6 centroid for coordinates per contracts/traffic-api.md
- [x] T033 [US4] Implement multi-source merger in `src/services/traffic/trafficMerger.ts` — 30m Haversine proximity threshold for overlap detection, confidence-weighted speed averaging for overlapping segments (`(speed_a × conf_a + speed_b × conf_b) / (conf_a + conf_b)`), max free-flow speed across sources, non-overlapping segments pass through, discard segments with timestamp older than previous merge
- [x] T034 [US4] Integrate merger into `src/services/traffic/trafficFlowService.ts` — fetch TomTom and HERE in parallel via `Promise.allSettled()`, normalize both, convert P2P probes from `trafficStore.segmentTraffic`, merge all three sources via `trafficMerger`, update `trafficStore.normalizedSegments` with merged result
- [x] T035 [US4] Handle partial source availability in `src/services/traffic/trafficFlowService.ts` — if one external API fails, merge remaining sources without error; if both fail, use P2P-only data; if all fail, keep previous segments

**Checkpoint**: All three data sources merged with confidence weighting. Partial availability handled gracefully. Map and ETA use best available merged data.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, cleanup, and final validation

- [x] T036 [P] Add JSDoc comments to all public exported functions in new files (`tomtomFetcher.ts`, `hereFetcher.ts`, `trafficMerger.ts`, `trafficFlowService.ts`, `etaCalculator.ts`)
- [x] T037 [P] Verify all `colors.traffic.*` theme tokens are used consistently across `TrafficOverlay.tsx`, `TrafficLegend.tsx`, and congestion threshold constants
- [x] T038 Run quickstart.md validation — execute dev flow steps from `specs/002-traffic-flow-eta/quickstart.md`, verify all commands succeed and features work as documented

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion (T001–T005) — BLOCKS all user stories
- **User Story 1 (Phase 3)**: Depends on Foundational (Phase 2) — no other story dependencies
- **User Story 2 (Phase 4)**: Depends on Foundational (Phase 2) — benefits from US1 traffic data being available but independently testable with mock data
- **User Story 3 (Phase 5)**: Depends on US1 (traffic fetching) and US2 (ETA calculation) — extends both
- **User Story 4 (Phase 6)**: Depends on Foundational (Phase 2) — enhances US1 fetching pipeline. Can proceed in parallel with US2/US3 but integration benefits from US1 being complete
- **Polish (Phase 7)**: Depends on all user stories being complete

### User Story Dependencies

- **US1 (P1)**: Phase 2 → US1. No story dependencies.
- **US2 (P2)**: Phase 2 → US2. Independently testable with mock traffic data. Benefits from US1 for real traffic data.
- **US3 (P3)**: Phase 2 → US1 → US2 → US3. Requires both traffic fetching (US1) and ETA calculation (US2).
- **US4 (P4)**: Phase 2 → US4. Can proceed after Phase 2 independently. Integration into flow service (T034) benefits from US1 orchestrator being complete.

### Within Each User Story

- Tests written first (fail before implementation)
- Models/types before services
- Services before UI components
- Core logic before integration/wiring
- Story complete → checkpoint validation

### Parallel Opportunities

- **Phase 1**: T002, T003, T004 can all run in parallel (independent files)
- **Phase 2**: T007, T008, T009 can run in parallel after T006 (all in same file but independent interfaces)
- **Phase 3 (US1)**: T012+T013 (tests) in parallel; T014+T015+T017 (fetcher, orchestrator, legend) in parallel
- **Phase 4 (US2)**: T019+T020 (tests) in parallel; T021+T023 (extractRouteSegments, formatETA) in parallel
- **Phase 6 (US4)**: T029+T030 (tests) in parallel; T031+T032 (HERE fetcher, P2P converter) in parallel
- **Cross-story**: US1 and US2 can be worked in parallel after Phase 2 (different files, different concerns). US4 can begin in parallel with US2/US3.

---

## Parallel Example: User Story 1

```bash
# Launch tests in parallel:
T012: "Unit test for TomTom normalizer in __tests__/unit/tomtomFetcher.test.ts"
T013: "Integration test for TrafficOverlay in __tests__/integration/trafficOverlay.test.tsx"

# Launch independent implementation files in parallel:
T014: "TomTom fetcher + normalizer in src/services/traffic/tomtomFetcher.ts"
T015: "Traffic flow orchestrator in src/services/traffic/trafficFlowService.ts"
T017: "Traffic legend component in src/components/map/TrafficLegend.tsx"

# Then sequential (depends on above):
T016: "Replace TrafficOverlay with LineLayer (depends on T014 for data shape)"
T018: "Wire flow service to viewport changes (depends on T015, T016)"
```

## Parallel Example: User Story 2

```bash
# Launch tests in parallel:
T019: "Unit tests for calculateTrafficETA in __tests__/unit/etaCalculator.test.ts"
T020: "Benchmark for calculateTrafficETA in __tests__/benchmark/etaCalculator.bench.ts"

# Launch independent utilities in parallel:
T021: "extractRouteSegments() in src/utils/etaCalculator.ts"
T023: "formatETA() in src/utils/etaCalculator.ts"

# Then sequential:
T022: "calculateTrafficETA() (depends on T021, T023 — same file)"
T024: "EtaDisplay modification (depends on T022 for data shape)"
T025: "Wire ETA on route activation (depends on T022, T024)"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001–T005)
2. Complete Phase 2: Foundational (T006–T011)
3. Complete Phase 3: User Story 1 (T012–T018)
4. **STOP and VALIDATE**: Verify traffic overlay renders colored road segments, legend visible, pan/zoom triggers refresh, silent fallback when API down
5. Deploy/demo if ready — users can see traffic on the map

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. Add US1 (traffic overlay) → **MVP! Users see colored roads**
3. Add US2 (traffic ETA) → Users get accurate ETAs → Deploy/Demo
4. Add US3 (dynamic updates) → ETAs update during navigation → Deploy/Demo
5. Add US4 (multi-source) → Best possible accuracy from all sources → Deploy/Demo
6. Polish → Documentation, consistency, validation → Final release
