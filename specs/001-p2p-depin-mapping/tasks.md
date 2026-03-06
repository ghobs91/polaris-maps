# Tasks: Decentralized P2P Mapping Platform (Polaris Maps)

**Input**: Design documents from `/specs/001-p2p-depin-mapping/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Not explicitly requested in the feature specification. Tests should be written alongside each implementation task per the constitution's testing standards.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and Expo bare workflow scaffold

- [x] T001 Initialize Expo bare workflow project with React Native 0.76+ and Expo SDK 52+ using `npx create-expo-app` then `npx expo prebuild`
- [x] T002 [P] Configure TypeScript 5.x with strict mode in tsconfig.json
- [x] T003 [P] Configure ESLint, Prettier, commitlint (Conventional Commits), and Husky pre-commit hooks in package.json and config files
- [x] T004 [P] Install core dependencies: @maplibre/maplibre-react-native, expo-sqlite, react-native-mmkv, zustand, @noble/secp256k1, expo-secure-store, expo-location, expo-camera via pnpm
- [x] T005 Create Expo Router file-based navigation skeleton with tab layout in app/\_layout.tsx and app/(tabs)/\_layout.tsx

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T006 Create SQLite database initialization service with schema creation (MapTile, Region, RoadSegment, GeocodingEntry, RouteHistory, PeerNode tables) in src/services/database/init.ts per data-model.md
- [x] T007 [P] Configure MMKV storage instance with default namespace in src/services/storage/mmkv.ts
- [x] T008 [P] Implement Nostr keypair generation (secp256k1 via @noble/curves) with expo-secure-store persistence in src/services/identity/keypair.ts
- [x] T009 [P] Implement Nostr Schnorr signing and verification utility in src/services/identity/signing.ts per contracts/gun-data-schema.md signature specs
- [x] T010 [P] Create Region model types in src/models/region.ts per data-model.md Region entity
- [x] T011 Implement Region SQLite repository (CRUD, spatial R-tree queries, download status transitions) in src/services/regions/regionRepository.ts per data-model.md
- [x] T012 [P] Initialize Gun.js with MMKV storage adapter and relay peer bootstrap in src/services/gun/init.ts per contracts/gun-data-schema.md relay bootstrap section
- [x] T013 [P] Create design system foundation (theme, typography, spacing, color tokens) in src/constants/theme.ts
- [x] T014 [P] Create common UI components (Button, Modal, LoadingSpinner, ErrorBoundary, SkeletonScreen) in src/components/common/
- [x] T015 [P] Create geohash utility functions (encode, decode, neighbors, bounding box) in src/utils/geohash.ts
- [x] T016 Create SettingsStore with resource limits and permission preferences in src/stores/settingsStore.ts

**Checkpoint**: Foundation ready — user story implementation can now begin in parallel

---

## Phase 3: User Story 1 — View and Navigate a Map (Priority: P1) 🎯 MVP

**Goal**: User opens the app, sees an interactive map, searches for addresses, and gets turn-by-turn navigation directions — all without any central server.

**Independent Test**: Install the app, open it, see a rendered map, search for a destination, and receive step-by-step directions. MapLibre renders PMTiles via local tile server. Valhalla computes routes on-device. Geocoding uses SQLite FTS5.

### Models

- [x] T017 [P] [US1] Create MapTile model types in src/models/tile.ts per data-model.md MapTile entity
- [x] T018 [P] [US1] Create RoadSegment model types in src/models/route.ts per data-model.md RoadSegment entity
- [x] T019 [P] [US1] Create GeocodingEntry and RouteHistory model types in src/models/geocoding.ts and src/models/routeHistory.ts per data-model.md

### Native Modules

- [x] T020 [US1] Implement PolarisTileServer native module (local HTTP server serving PMTiles as {z}/{x}/{y}.mvt to MapLibre) with iOS and Android implementations in src/native/tileServer/ per contracts/native-modules.md Contract 2
- [x] T021 [US1] Implement PolarisValhalla native module (C++ JSI bridge for route computation) with iOS and Android implementations in src/native/valhalla/ per contracts/native-modules.md Contract 1

### Services

- [x] T022 [US1] Implement map tile service (PMTiles loading, tile caching, LRU eviction, Arweave fallback) in src/services/map/tileService.ts using PolarisTileServer module
- [x] T023 [US1] Implement routing service (computeRoute, reroute, alternate routes, costing models) in src/services/routing/routingService.ts using PolarisValhalla module
- [x] T024 [US1] Implement geocoding service (FTS5 address search, R-tree reverse geocoding, result ranking) in src/services/geocoding/geocodingService.ts per data-model.md GeocodingEntry
- [x] T025 [US1] Implement route history service (save, list, delete recent routes) in src/services/routing/routeHistoryService.ts per data-model.md RouteHistory

### Stores

- [x] T026 [P] [US1] Create MapStore (viewport, tile loading state, selected location, map style) in src/stores/mapStore.ts
- [x] T027 [P] [US1] Create NavigationStore (active route, current step, ETA, deviation detection) in src/stores/navigationStore.ts

### Components

- [x] T028 [US1] Create MapView component integrating @maplibre/maplibre-react-native with local tile server URL in src/components/map/MapView.tsx
- [x] T029 [P] [US1] Create map control components (zoom buttons, compass, current location button) in src/components/map/MapControls.tsx
- [x] T030 [US1] Create SearchBar and SearchResults components with FTS5 integration in src/components/search/SearchBar.tsx and src/components/search/SearchResults.tsx
- [x] T031 [US1] Create turn-by-turn navigation UI components (maneuver list, next-turn banner, ETA display) in src/components/navigation/

### Screens

- [x] T032 [US1] Implement Map screen (home tab) with MapView, controls, location marker, and route overlay in app/(tabs)/index.tsx
- [x] T033 [US1] Implement Search screen with SearchBar, results list, and map centering on selection in app/(tabs)/search.tsx
- [x] T034 [US1] Implement Navigation screen with active route guidance, rerouting on deviation, and voice-ready maneuver data in app/(tabs)/navigation.tsx
- [x] T035 [US1] Implement Onboarding screen with location permission request and initial region selection in app/onboarding/index.tsx

**Checkpoint**: User Story 1 fully functional — map viewing, search, and turn-by-turn navigation work independently

---

## Phase 4: User Story 2 — Real-Time Traffic Data (Priority: P1)

**Goal**: Devices passively collect and share anonymized speed telemetry via Waku P2P. Users see color-coded traffic overlays. Navigation factors live traffic into routes and re-routes dynamically.

**Independent Test**: Drive on a congested highway; nearby peers' maps update to show congestion. A second user requesting directions through the area receives an alternative route.

### Models

- [x] T036 [P] [US2] Create TrafficObservation model types (probe, aggregated state, congestion levels) in src/models/traffic.ts per data-model.md TrafficObservation entity

### Waku Sidecar

- [x] T037 [US2] Bootstrap nodejs-mobile sidecar with Waku v2 light-push + filter mode in nodejs-assets/nodejs-project/index.js with protobuf message encoding per contracts/waku-protocol.md
- [x] T038 [US2] Implement Waku bridge service (RN ↔ sidecar event bridge: subscribe, unsubscribe, publish, status) in src/services/traffic/wakuBridge.ts per contracts/waku-protocol.md nodejs-mobile bridge section

### Services

- [x] T039 [US2] Implement traffic probe collector (GPS → anonymized TrafficProbe with ephemeral probe_id, 5s publish interval) in src/services/traffic/probeCollector.ts per contracts/waku-protocol.md TrafficProbe schema
- [x] T040 [US2] Implement Waku topic subscription manager (viewport-based geohash6 grid, debounced resubscription, max 59 concurrent topics) in src/services/traffic/topicManager.ts per contracts/waku-protocol.md subscription management
- [x] T041 [US2] Implement traffic aggregation service (incoming probes → per-segment rolling average → congestion levels) in src/services/traffic/trafficAggregator.ts per data-model.md aggregated traffic state
- [x] T042 [US2] Integrate live traffic speeds with Valhalla via updateTrafficSpeeds bridge in src/services/routing/routingService.ts per contracts/native-modules.md Contract 1
- [x] T043 [US2] Implement traffic-aware rerouting (detect congestion change → suggest alternative → proactive notification) in src/services/traffic/rerouteService.ts

### UI

- [x] T044 [US2] Create TrafficStore (active probes, segment congestion map, subscription state) in src/stores/trafficStore.ts
- [x] T045 [US2] Create traffic overlay component (color-coded road segments: green/yellow/red on MapView) in src/components/map/TrafficOverlay.tsx

**Checkpoint**: User Story 2 fully functional — traffic probes flow, overlays render, routing uses live traffic

---

## Phase 5: User Story 3 — Business/Place Information (Priority: P2)

**Goal**: Users search for nearby businesses, see listings with hours/reviews/ratings, add new listings, suggest edits, and leave reviews. All data syncs via Gun.js with Nostr-signed trust verification.

**Independent Test**: Search "coffee shops near me," see a list of nearby cafés with hours and ratings, tap one for details, add a review — all resolved via Gun.js peers.

### Models

- [x] T046 [P] [US3] Create Place model types in src/models/poi.ts per data-model.md Place entity and contracts/gun-data-schema.md Contract 1
- [x] T047 [P] [US3] Create Review model types in src/models/review.ts per data-model.md Review entity and contracts/gun-data-schema.md Contract 2
- [x] T048 [P] [US3] Create DataEdit model types in src/models/dataEdit.ts per data-model.md DataEdit entity and contracts/gun-data-schema.md Contract 4
- [x] T049 [P] [US3] Create UserReputation model types in src/models/reputation.ts per data-model.md UserReputation entity and contracts/gun-data-schema.md Contract 3

### Services

- [x] T050 [US3] Implement POI service (Gun.js CRUD + SQLite cache sync, FTS5 category/name search, Nostr signature on writes) in src/services/poi/poiService.ts per contracts/gun-data-schema.md Contract 1
- [x] T051 [US3] Implement review service (create/update reviews, one-per-author constraint, avg rating recomputation) in src/services/poi/reviewService.ts per contracts/gun-data-schema.md Contract 2
- [x] T052 [US3] Implement reputation computation service (local score calculation from Gun.js contribution history) in src/services/poi/reputationService.ts per contracts/gun-data-schema.md Contract 3 score formula
- [x] T053 [US3] Implement data edit proposal and auto-resolution service (submit edits, corroborate/dispute, apply resolution rules) in src/services/poi/editService.ts per contracts/gun-data-schema.md Contract 4 auto-resolution rules
- [x] T054 [US3] Implement POI attestation service (Waku-based proximity confirmation) in src/services/poi/attestationService.ts per contracts/waku-protocol.md POIAttestation schema (depends on US2 Waku infrastructure)

### Store & Components

- [x] T055 [US3] Create POIStore (nearby places, search results, selected place, active edits) in src/stores/poiStore.ts
- [x] T056 [P] [US3] Create POI card and list components in src/components/poi/POICard.tsx and src/components/poi/POIList.tsx
- [x] T057 [P] [US3] Create review and rating display components in src/components/poi/ReviewCard.tsx and src/components/poi/RatingWidget.tsx

### Screens

- [x] T058 [US3] Implement POI detail screen (name, address, hours, phone, category, ratings, reviews, edit button) in app/poi/[id].tsx
- [x] T059 [US3] Implement POI editor screen (create new listing, suggest edits, mark closed, Nostr signing) in app/poi/edit.tsx
- [x] T060 [US3] Implement Reviews screen (review list, add review form, rating input) in app/poi/reviews.tsx

**Checkpoint**: User Story 3 fully functional — POI search, detail view, editing, reviews, and reputation all work via Gun.js

---

## Phase 6: User Story 4 — Join the Network as a Node (Priority: P2)

**Goal**: Every device automatically joins the P2P network, caches local tiles, serves data to nearby peers, and replicates routing graph deltas via Hypercore. Users see their contribution metrics on a dashboard.

**Independent Test**: Install the app, grant permissions — within 1 minute the device is caching local tiles, listed as a peer, and the dashboard shows metrics.

### Models

- [x] T061 [P] [US4] Create PeerNode model types in src/models/peer.ts per data-model.md PeerNode entity

### Hypercore Integration

- [x] T062 [US4] Implement Hypercore sync module via react-native-bare-kit (RN ↔ Bare event bridge: join-feed, leave-feed, get-entry, sync-progress) in src/native/hypercore/ per contracts/native-modules.md Contract 3

### Services

- [x] T063 [US4] Implement peer network service (auto-join on launch, peer discovery, tile caching for local radius, serve cached tiles to peers) in src/services/sync/peerService.ts
- [x] T064 [US4] Implement Hypercore feed sync service (routing graph delta replication, region manifest feeds) in src/services/sync/feedSyncService.ts per contracts/native-modules.md Hypercore feed discovery
- [x] T065 [US4] Implement resource limit management service (enforce storage/bandwidth/battery budgets from SettingsStore) in src/services/sync/resourceManager.ts per data-model.md PeerNode resource limits

### Store, Components & Screens

- [x] T066 [US4] Create PeerStore (active peer connections, sync status, contribution metrics) in src/stores/peerStore.ts
- [x] T067 [US4] Create node dashboard components (contribution metrics cards, peer count, coverage map, uptime display) in src/components/dashboard/
- [x] T068 [US4] Implement Profile/Dashboard screen (node metrics, peer connections, regions covered, data served) in app/(tabs)/profile.tsx
- [x] T069 [US4] Implement Settings screen with resource contribution sliders (max storage MB, max bandwidth, max battery %/hr) in app/settings/index.tsx

**Checkpoint**: User Story 4 fully functional — devices participate as nodes, replicate data via Hypercore, and display contribution metrics

---

## Phase 7: User Story 5 — Offline Maps (Priority: P3)

**Goal**: Users download geographic regions for full offline use — map viewing, search, and routing work without connectivity. Data syncs automatically when reconnected.

**Independent Test**: Pre-cache a metropolitan area, enable airplane mode, view the map, search addresses, and compute driving directions throughout that area.

- [x] T070 [US5] Implement region download service (download PMTiles + Valhalla graph + geocoding DB bundles from Arweave, progress tracking, resume on failure) in src/services/regions/downloadService.ts
- [x] T071 [P] [US5] Implement connectivity detection service (online/offline state, network quality) in src/services/regions/connectivityService.ts
- [x] T072 [US5] Implement offline-aware geocoding fallback (use only local SQLite FTS5 when offline) in src/services/geocoding/geocodingService.ts
- [x] T073 [US5] Implement offline-aware routing fallback (use only cached Valhalla graph when offline, skip traffic) in src/services/routing/routingService.ts
- [x] T074 [US5] Implement offline queue service (buffer telemetry probes, POI edits, and reviews during offline; flush on reconnect) in src/services/sync/offlineQueue.ts
- [x] T075 [US5] Create region download UI components (region list, download progress, storage usage) in src/components/regions/
- [x] T076 [US5] Implement Region download manager screen (browse available regions, initiate download, show progress) in app/regions/index.tsx
- [x] T077 [US5] Implement Offline region manager screen (list downloaded regions, delete, check for updates) in app/regions/offline.tsx

**Checkpoint**: User Story 5 fully functional — offline maps, search, routing, and sync-on-reconnect all work

---

## Phase 8: User Story 6 — Street-Level Imagery (Priority: P3)

**Goal**: Users capture geotagged street-level photos while driving or walking. Faces and plates are auto-blurred. Imagery is distributed via Hypercore and browsable by other users.

**Independent Test**: Capture street-level photos along a route; another user browsing that street later sees the imagery and can pan through it.

- [x] T078 [P] [US6] Create StreetImagery model types in src/models/imagery.ts per data-model.md StreetImagery entity
- [x] T079 [US6] Implement camera capture service (geotagged interval capture, bearing recording, image queue) in src/services/imagery/captureService.ts using expo-camera and expo-location
- [x] T080 [US6] Implement face and license plate blurring service (on-device detection and blur before distribution) in src/services/imagery/blurService.ts
- [x] T081 [US6] Implement imagery upload service (blurred images → Hypercore feed, metadata → Gun.js) in src/services/imagery/uploadService.ts (depends on US4 Hypercore infrastructure)
- [x] T082 [US6] Implement imagery browse service (fetch metadata from Gun.js, stream images from Hypercore peers by geohash) in src/services/imagery/browseService.ts
- [x] T083 [US6] Create street-level imagery viewer component (photo browser, bearing indicator, date selector) in src/components/imagery/ImageryViewer.tsx
- [x] T084 [US6] Implement imagery viewer screen (browse street-level photos on map, enter/exit viewer) in app/imagery/viewer.tsx
- [x] T085 [US6] Implement camera capture mode screen (viewfinder, capture controls, upload queue status) in app/imagery/capture.tsx

**Checkpoint**: User Story 6 fully functional — capture, blur, distribute, and browse street imagery

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [x] T086 [P] Implement granular privacy consent flow (opt-in for location, traffic telemetry, POI contributions, imagery sharing — independently togglable) in app/onboarding/index.tsx and src/services/identity/consent.ts
- [x] T087 [P] Performance validation pass: verify 60fps map rendering, <2s route computation, <5s cold launch, <300MB memory budget per constitution requirements
- [x] T088 [P] Add offline/degraded-network visual indicators across all screens per constitution UX Consistency principle (connectivity banner, disabled feature hints)
- [x] T089 Code cleanup: remove dead code, verify single-responsibility per module, ensure no unused imports across src/
- [x] T090 Run quickstart.md validation checklist and verify all smoke test items pass

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all user stories
- **User Stories (Phase 3–8)**: All depend on Foundational phase completion
  - Stories can proceed in parallel (if staffed) or sequentially in priority order
- **Polish (Phase 9)**: Depends on all desired user stories being complete

### User Story Dependencies

| Story                        | Depends On                                         | Notes                                                                       |
| ---------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------- |
| US1 (P1): Map & Navigate     | Foundational only                                  | No cross-story deps — true MVP                                              |
| US2 (P1): Traffic            | Foundational only                                  | Independent Waku infrastructure                                             |
| US3 (P2): Business/POI       | Foundational only                                  | Gun.js init is in Foundational; T054 (attestation) optionally uses US2 Waku |
| US4 (P2): Node Participation | Foundational only                                  | Independent Hypercore infrastructure                                        |
| US5 (P3): Offline Maps       | US1 (needs map/routing/geocoding services to wrap) | Extends US1 services with offline fallbacks                                 |
| US6 (P3): Street Imagery     | US4 (T081 uploads to Hypercore feeds from US4)     | Imagery browse works independently; upload needs Hypercore                  |

### Within Each User Story

1. Models first (types and schemas)
2. Native modules / infrastructure before services that use them
3. Services before stores
4. Stores and components before screens
5. Core implementation before integration with other stories

### Parallel Opportunities per Story

**US1**: T017 ‖ T018 ‖ T019 → then T020 → T021 sequentially; T026 ‖ T027 stores in parallel; T029 controls parallel with T028 search
**US2**: T036 model parallel with nothing (single model); T039-T041 services sequential (each builds on Waku bridge)
**US3**: T046 ‖ T047 ‖ T048 ‖ T049 all models in parallel; T056 ‖ T057 components in parallel
**US4**: T061 model alone; services sequential after Hypercore module
**US5**: T071 connectivity parallel with T070 download service
**US6**: T078 model alone; services sequential (capture → blur → upload → browse)

---

## Parallel Example: User Story 1 (MVP)

```
# Parallel batch 1 — Models (all different files):
T017: Create MapTile model types in src/models/tile.ts
T018: Create RoadSegment model types in src/models/route.ts
T019: Create GeocodingEntry and RouteHistory model types

# Sequential — Native modules (shared native project config):
T020: Implement PolarisTileServer native module
T021: Implement PolarisValhalla native module

# Sequential — Services (depend on native modules):
T022: Map tile service (depends on T020)
T023: Routing service (depends on T021)
T024: Geocoding service (independent)
T025: Route history service (independent)

# Parallel batch 2 — Stores (different files):
T026: MapStore
T027: NavigationStore

# Parallel batch 3 — Components:
T028: SearchBar + SearchResults
T029: Map controls
T030: Search components
T031: Navigation components

# Sequential — Screens (depend on components + services):
T032: Map screen
T033: Search screen
T034: Navigation screen
T035: Onboarding screen
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001–T005)
2. Complete Phase 2: Foundational (T006–T016)
3. Complete Phase 3: User Story 1 (T017–T035)
4. **STOP and VALIDATE**: Map renders, search works, navigation works — no servers needed
5. This is a functional mapping app ready for demo

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. **Add US1** → Map + Search + Navigation (MVP!)
3. **Add US2** → Live traffic overlays + traffic-aware routing
4. **Add US3** → Business listings, reviews, reputation
5. **Add US4** → P2P node participation, Hypercore sync
6. **Add US5** → Full offline capability
7. **Add US6** → Street-level imagery
8. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers after Foundational is complete:

- Developer A: US1 (Map & Navigate) — MVP path
- Developer B: US2 (Traffic) — parallel with US1
- Developer C: US3 (Business/POI) — parallel with US1/US2
- After US1+US4 done → Developer D: US5 (Offline) + US6 (Imagery)

---

## Notes

- [P] tasks = different files, no dependencies on other tasks in same phase
- [Story] label maps task to specific user story
- Each user story is independently completable and testable (except noted cross-deps)
- Commit after each task following Conventional Commits format (`feat(map):`, `feat(traffic):`, etc.)
- Constitution requires tests alongside each implementation — write tests with each task, not as separate tasks
- Native module tasks (T020, T021, T037, T062) are the highest-risk items — budget extra time
- All Arweave transaction IDs are placeholders until data pipeline is built
