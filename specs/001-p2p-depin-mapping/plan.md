# Implementation Plan: Decentralized P2P Mapping Platform (Polaris Maps)

**Branch**: `001-p2p-depin-mapping` | **Date**: 2026-03-05 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/001-p2p-depin-mapping/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Polaris Maps is a fully decentralized, zero-backend mobile mapping application built with React Native (Expo bare workflow) targeting iOS and Android. Map tiles are PMTiles archives (Overture Maps Foundation data) stored permanently on Arweave and rendered via MapLibre. Routing runs entirely on-device using a Valhalla native module against locally-cached graph bundles. Real-time traffic flows through Waku v2 (libp2p GossipSub) with every device acting as a relay node. POI data syncs via Gun.js (decentralized graph DB) with Nostr keypair-signed business listings. Geocoding uses on-device Pelias extracts in SQLite FTS5. Hypercore Protocol handles large mutable dataset sync (routing graph deltas, POI edits). The architecture ensures the app remains fully functional if the developer disappears — zero app-creator-hosted infrastructure.

## Technical Context

**Language/Version**: TypeScript 5.x (React Native JS layer), C++ (Valhalla native module), Objective-C/Swift (iOS native bridges), Kotlin/Java (Android native bridges)
**Primary Dependencies**: React Native 0.76+, Expo SDK 52+ (bare workflow), @maplibre/maplibre-react-native, Valhalla (compiled as native module), Waku v2 (via nodejs-mobile-react-native sidecar), Gun.js, react-native-bare-kit (Hypercore/Holepunch), expo-sqlite, Zustand, react-native-mmkv, @noble/secp256k1 (Nostr keypair)
**Storage**: SQLite (expo-sqlite) for routing graphs, geocoding indexes, tile metadata, POI cache, route history; MMKV for key-value preferences; Arweave for permanent immutable data (PMTiles, routing graphs, Pelias extracts); Gun.js for decentralized mutable graph data (POI edits, reviews, reputation)
**Testing**: Jest (unit tests), React Native Testing Library (component tests), Detox (E2E/integration tests on device), benchmark tests for performance-sensitive paths (Valhalla routing, MapLibre rendering, Waku message throughput)
**Target Platform**: iOS 15+, Android API 26+ (Android 8.0+)
**Project Type**: Mobile app (React Native, Expo bare workflow)
**Performance Goals**: 60fps map rendering, <2s route computation (100km on mid-range device), <5s cold launch to interactive map, <2s warm launch, <100ms map interaction response
**Constraints**: <300MB memory (foreground), <50MB memory (background node), <5% battery/hr (background), fully offline-capable for cached regions, zero server-side infrastructure
**Scale/Scope**: ~15 screens (map, search, navigation, POI detail, POI editor, reviews, node dashboard, settings, onboarding, region download, offline manager, street imagery viewer, capture mode, profile, permissions), initial coverage US metropolitan areas

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

### I. Code Quality

- **PASS**: Single-responsibility modules planned — map rendering, routing engine, traffic layer, POI sync, geocoding, and P2P networking are separate concerns with clear module boundaries. TypeScript enforces typing. ESLint + Prettier enforced via pre-commit hooks.

### II. Testing Standards (NON-NEGOTIABLE)

- **PASS**: Jest for unit tests of all public functions, React Native Testing Library for component tests, Detox for E2E user story validation. Contract tests planned for Waku message schemas, Gun.js data shapes, and Hypercore feed formats. Benchmark tests for Valhalla routing and MapLibre rendering.

### III. User Experience Consistency

- **PASS**: Single design system covering all ~15 screens. MapLibre provides consistent map interaction patterns. Offline/degraded states distinguished via connectivity-aware UI layer. Error states use user-facing messages, never raw errors.

### IV. Performance Requirements

- **PASS**: MapLibre's native GL renderer targets 60fps. Valhalla native module runs off-JS-thread for <2s routing. Waku runs in nodejs-mobile sidecar (separate thread). MMKV for instant preference reads. Memory and battery budgets defined per constitution.

### V. Atomic Commits

- **PASS**: Feature decomposed into independent user stories. Each story further decomposed into model/service/screen commits. Conventional Commits enforced via commitlint in CI.

### Security & Privacy Standards

- **PASS**: Nostr keypair (secp256k1) stored in device secure enclave. All Waku messages encrypted. Telemetry anonymized on-device before transmission. Granular permission controls per data type. Dependencies audited via `npm audit` in CI.

### Development Workflow

- **PASS**: PR-based flow against feature branch. CI runs lint + format + build + test suite. Code review required before merge. Rebase strategy for feature branches.

**Gate result: ALL PASS — proceed to Phase 0.**

### Post-Phase 1 Re-Check

After completing data-model.md, contracts/, and quickstart.md:

#### I. Code Quality — PASS

Data model defines 8 entities with clear single responsibilities. Contracts enforce strict module boundaries between Waku protocol layer, Gun.js data layer, and native module bridges. No entity mixes rendering, networking, and storage concerns.

#### II. Testing Standards — PASS

Contract files explicitly define the message schemas and API surfaces that contract tests will validate (Waku protobuf messages, Gun.js graph paths, native module bridge methods). Benchmark thresholds documented for routing (<2s), tile loading, geocoding (<30ms FTS5 queries).

#### III. UX Consistency — PASS

Data model includes explicit offline state fields (`isAvailableOffline`, `cachedAt`) on entities (MapTile, PlaceListing) enabling consistent offline/degraded UX indicators. Error states representable in all entity schemas.

#### IV. Performance Requirements — PASS

Storage layer split designed to stay within constitution memory budgets: SQLite for indexed queries, MMKV for instant KV reads, Arweave for cold/permanent storage, Gun.js for hot mutable data. Data model fields include cache timestamps for LRU eviction. Waku sidecar runs off-UI-thread by architecture.

#### V. Atomic Commits — PASS

Each data entity, each contract, and each native module bridge is independently implementable and testable. The decomposition directly supports atomic commits: one entity = one commit, one contract = one commit.

#### Security & Privacy — PASS

All mutable data (PlaceListing, DataEdit, UserReputation) requires Nostr signature verification defined in data model. Waku message schemas include `signature` fields. Gun.js paths enforce per-user write scoping. No raw location data in any protocol message — traffic probes use geohash-aggregated speed values only.

**Post-Phase 1 Gate result: ALL PASS — plan design is constitution-compliant.**

## Project Structure

### Documentation (this feature)

```text
specs/001-p2p-depin-mapping/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (repository root)

```text
app/                              # Expo Router app directory
├── (tabs)/                       # Tab-based navigation
│   ├── index.tsx                 # Map screen (home)
│   ├── search.tsx                # Search/geocoding screen
│   ├── navigation.tsx            # Active navigation screen
│   └── profile.tsx               # Node dashboard + settings
├── poi/
│   ├── [id].tsx                  # POI detail screen
│   ├── edit.tsx                  # POI editor screen
│   └── reviews.tsx               # Reviews screen
├── regions/
│   ├── index.tsx                 # Region download manager
│   └── offline.tsx               # Offline region manager
├── imagery/
│   ├── viewer.tsx                # Street-level imagery viewer
│   └── capture.tsx               # Camera capture mode
├── onboarding/
│   └── index.tsx                 # Onboarding + permissions flow
├── settings/
│   └── index.tsx                 # Full settings screen
└── _layout.tsx                   # Root layout

src/
├── components/                   # Shared UI components
│   ├── map/                      # Map-related components (markers, overlays, controls)
│   ├── navigation/               # Turn-by-turn UI components
│   ├── poi/                      # POI cards, list items, rating widgets
│   ├── search/                   # Search bar, results list
│   └── common/                   # Buttons, modals, loading states, error boundaries
├── services/                     # Business logic services
│   ├── map/                      # Tile fetching, PMTiles, cache management
│   ├── routing/                  # Valhalla bridge, route computation, rerouting
│   ├── traffic/                  # Waku traffic pub/sub, probe collection, aggregation
│   ├── poi/                      # Gun.js POI sync, CRUD, reputation
│   ├── geocoding/                # Pelias SQLite FTS5 search, reverse geocoding
│   ├── sync/                     # Hypercore feed management, delta sync
│   ├── identity/                 # Nostr keypair management, signing
│   └── regions/                  # Region download, cache lifecycle, offline manager
├── models/                       # TypeScript type definitions and schemas
│   ├── tile.ts
│   ├── route.ts
│   ├── traffic.ts
│   ├── poi.ts
│   ├── peer.ts
│   ├── imagery.ts
│   ├── reputation.ts
│   └── region.ts
├── stores/                       # Zustand state stores
│   ├── mapStore.ts
│   ├── navigationStore.ts
│   ├── trafficStore.ts
│   ├── poiStore.ts
│   ├── peerStore.ts
│   └── settingsStore.ts
├── native/                       # Native module bridges
│   ├── valhalla/                 # Valhalla C++ → RN bridge (iOS + Android)
│   └── waku/                     # nodejs-mobile Waku sidecar bootstrap
├── hooks/                        # Custom React hooks
├── utils/                        # Pure utility functions (geohash, math, formatting)
├── constants/                    # App-wide constants, config
└── types/                        # Global TypeScript type declarations

ios/                              # iOS native project (Expo bare)
android/                          # Android native project (Expo bare)

__tests__/
├── unit/                         # Jest unit tests (mirrors src/ structure)
├── integration/                  # Component integration tests (RNTL)
├── contract/                     # Protocol contract tests (Waku, Gun.js, Hypercore)
├── e2e/                          # Detox end-to-end tests
└── benchmarks/                   # Performance benchmark tests
```

**Structure Decision**: React Native Expo bare workflow with Expo Router for file-based navigation. Source code under `src/` with clear separation: `services/` for business logic, `models/` for types, `stores/` for state, `native/` for C++/platform bridges, `components/` for UI. Tests mirror source structure under `__tests__/`. Native projects (`ios/`, `android/`) managed by Expo but require manual native module linking for Valhalla, nodejs-mobile, and bare-kit.

## Complexity Tracking

| Violation                         | Why Needed                                                                                    | Simpler Alternative Rejected Because                                                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| nodejs-mobile sidecar for Waku    | Waku v2 requires a full libp2p Node.js runtime; cannot run in React Native's Hermes JS engine | Pure-JS libp2p lacks GossipSub relay capability on mobile; HTTP-based relay would require a server (violates zero-infrastructure constraint)    |
| Valhalla C++ native module        | On-device routing with costing profiles requires a compiled routing engine                    | JS-based routing engines (OSRM.js) are too slow for real-time rerouting on mobile; server-based routing violates zero-infrastructure constraint |
| react-native-bare-kit (Hypercore) | Hypercore requires native runtime for efficient append-only log replication and P2P streaming | Gun.js alone cannot efficiently handle large binary dataset sync (routing graphs, tile deltas); HTTP-based file sync would require a server     |
