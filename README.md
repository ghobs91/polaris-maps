# Polaris Maps

A decentralized, peer-to-peer mapping application built with React Native / Expo. Polaris Maps combines real-time traffic data, offline vector maps, point-of-interest contribution, and a DePIN (Decentralized Physical Infrastructure Network) incentive layer — all without a centralized backend.

---

## Table of Contents

- [Core Functionalities](#core-functionalities)
  - [Real-Time Traffic & ETA](#1-real-time-traffic--eta)
  - [P2P Networking & Data Sync](#2-p2p-networking--data-sync)
  - [Points of Interest (POI)](#3-points-of-interest-poi)
  - [Geocoding & Search](#4-geocoding--search)
  - [Navigation & Routing](#5-navigation--routing)
  - [Public Transit](#6-public-transit)
  - [Street-Level Imagery](#7-street-level-imagery)
  - [Offline Regions](#8-offline-regions)
  - [Identity & Security](#9-identity--security)
  - [Map Rendering](#10-map-rendering)
  - [Place Lists & Favorites](#11-place-lists--favorites)
  - [CarPlay Integration](#12-carplay-integration)
  - [OSM Editing](#13-osm-editing)
  - [P2P Node Dashboard](#14-p2p-node-dashboard)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Testing](#testing)
- [Security](#security)

---

## Core Functionalities

### 1. Real-Time Traffic & ETA

Live traffic flow overlay with color-coded congestion visualization and dynamic ETA adjustment during navigation.

- **Multi-source fusion** — merges TomTom Traffic Flow v4, HERE Traffic Flow v7, and crowd-sourced P2P probes from Hyperswarm peers into a unified congestion picture
- **Probe collection** — the device periodically publishes its GPS-derived speed as an anonymous traffic probe to nearby peers via geohash4 topic channels
- **Traffic-adjusted ETA** — route segments are matched to geohash6-indexed traffic data using spatial proximity search; congestion ratios adjust the base Valhalla ETA in real time
- **Smart rerouting** — monitors active routes every 30s and triggers automatic rerouting via Valhalla when ≥25% congestion slowdown is detected
- **Nostr fallback** — when Hyperswarm peer count drops below 3, traffic probes are relayed through Nostr (kind 20100) with full Schnorr signature verification

| Directory                                                  | Description                                                                                           |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| [`src/services/traffic/`](src/services/traffic/)           | Traffic fetchers, P2P probe collection, aggregation, merging, rerouting, and Hyperswarm/Nostr bridges |
| [`src/utils/etaCalculator.ts`](src/utils/etaCalculator.ts) | Geohash6-indexed route-to-traffic segment matching for dynamic ETA                                    |
| [`src/stores/trafficStore.ts`](src/stores/trafficStore.ts) | Zustand store for traffic segments, peer counts, and traffic mode                                     |
| [`backend/traffic-swarm.mjs`](backend/traffic-swarm.mjs)   | Bare worklet running Hyperswarm inside react-native-bare-kit                                          |

> **Deep dive →** [src/services/traffic/README.md](src/services/traffic/README.md)

---

### 2. P2P Networking & Data Sync

Fully decentralized data layer using Hyperswarm for real-time peer discovery, Hyperdrive for file replication, and Gun.js for conflict-free data sync.

- **Hyperswarm** — geohash4-based topic discovery (~39 km cells) for finding nearby peers; runs inside a Bare worklet via react-native-bare-kit with bare-rpc IPC
- **Hyperdrive** — peer-assisted region downloads where devices seed previously downloaded map tile packs to the network
- **Gun.js** — CRDT-based sync for POI edits, reviews, attestations, and reputation data with relay peer discovery
- **Offline queue** — outbound actions (traffic probes, edits, reviews) are queued in MMKV when offline (500-entry cap) and replayed when connectivity returns
- **Resource management** — user-configurable budgets for storage (MB), bandwidth (Mbps), and battery (%/hr) with enforcement

| Directory                                                        | Description                                                                       |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [`src/services/sync/`](src/services/sync/)                       | Feed sync, Hyperdrive bridge, offline queue, peer service, resource manager       |
| [`src/services/gun/`](src/services/gun/)                         | Gun.js initialization with MMKV storage adapter and relay discovery               |
| [`nodejs-assets/nodejs-project/`](nodejs-assets/nodejs-project/) | Node.js sidecar handling Hyperdrive seed/download, tar extraction, and bridge IPC |
| [`backend/`](backend/)                                           | Bare worklet entry point for Hyperswarm traffic P2P                               |
| [`src/stores/peerStore.ts`](src/stores/peerStore.ts)             | Local node identity, active peers, syncing feeds, online status                   |

> **Deep dive →** [src/services/sync/README.md](src/services/sync/README.md)

---

### 3. Points of Interest (POI)

Multi-source POI system combining Overture Maps (local SQLite), OpenStreetMap (Overpass API), Apple MapKit enrichment, and P2P crowd-sourced contributions.

- **3-phase fetch** — Phase 1: instant local Overture SQLite results; Phase 2: parallel Overpass + online Overture (skipped if ≥20 local results); Phase 3: Nominatim fallback
- **Spatial filtering** — zoom-adaptive density limits (80–300 POIs), Web Mercator pixel-exclusion with category-diverse round-robin interleaving
- **POI enrichment** — Apple MapKit native iOS enrichment fills missing phone, website, address, hours, and logo for selected POIs
- **Edits & reviews** — field-level POI edits signed with Schnorr keypair, published to Gun.js for peer corroboration; 1–5 star reviews synced via Gun.js
- **Attestation** — cryptographic proof-of-presence (≤100m GPS proximity) for confirming a POI exists at its claimed location
- **Reputation** — composite scores from POI contributions, confirmations, and traffic probe accuracy, stored in Gun.js with signature verification

| Directory                                                            | Description                                                                                        |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [`src/services/poi/`](src/services/poi/)                             | OSM/Overture fetchers, category search, MapKit enrichment, edits, reviews, attestation, reputation |
| [`src/components/poi/`](src/components/poi/)                         | POI detail card, info display, and edit UI components                                              |
| [`src/components/map/POILayer.tsx`](src/components/map/POILayer.tsx) | Map marker rendering with pill badges, icon colors, and spatial filtering                          |
| [`src/stores/osmPoiStore.ts`](src/stores/osmPoiStore.ts)             | Viewport POIs, selected POI, enrichment data, category search state                                |
| [`src/utils/poiSpatialFilter.ts`](src/utils/poiSpatialFilter.ts)     | Zoom-adaptive density filtering with placement grid                                                |
| [`src/utils/poiCategories.ts`](src/utils/poiCategories.ts)           | Icon/color mappings for 60+ POI categories                                                         |

> **Deep dive →** [src/services/poi/README.md](src/services/poi/README.md)

---

### 4. Geocoding & Search

Unified search pipeline combining local FTS5 full-text search, Photon geocoding, Overpass category search, and natural-language query parsing.

- **Local-first FTS5** — expo-sqlite FTS5 index over Overture places and a GeoNames cities1000 database (~140k cities) for instant offline results
- **Photon geocoder** — Komoot Photon API providing fuzzy, typo-tolerant OSM-based geocoding with structured address metadata
- **Query parser** — extracts brand names, cuisine hints, modifiers ("near me", "open now"), and resolved POI categories from natural-language input
- **Search ranker** — scores results 0–100 by combining Levenshtein distance, name containment, viewport distance, category match, and popularity signals
- **Parallel execution** — local FTS5, category Overpass, Photon, and address search run in parallel; results are deduplicated and relevance-ranked
- **Search history** — last 10 selections persisted in MMKV for recents display

| Directory                                            | Description                                                                 |
| ---------------------------------------------------- | --------------------------------------------------------------------------- |
| [`src/services/search/`](src/services/search/)       | Unified search orchestrator, query parser, Photon geocoder, ranker, history |
| [`src/services/geocoding/`](src/services/geocoding/) | FTS5 local geocoding, GeoNames global geocoder, Nominatim fallback          |
| [`src/components/search/`](src/components/search/)   | SearchBar, SearchResults, SearchHistory UI components                       |

> **Deep dive →** [src/services/search/README.md](src/services/search/README.md)

---

### 5. Navigation & Routing

Turn-by-turn navigation with Valhalla routing, GPS snap-to-route, off-route detection, traffic-aware rerouting, and park-and-ride suggestions.

- **Valhalla routing** — online route computation with maneuver-level turn instructions and encoded polyline geometry
- **Route snap** — GPS position snapped to nearest polyline point with bearing computation, remaining distance tracking, and off-route detection (50m threshold)
- **Traffic-adjusted ETA** — live ETA updates every 60s during active navigation using route bounding-box traffic data
- **Smart rerouting** — automatic reroute triggered when congestion adds ≥25% delay, using live traffic speeds as Valhalla edge weights
- **Park-and-ride** — detects when the user is >20 min walk from a rail station and suggests a combined drive + transit trip
- **Route history** — navigated routes persisted to SQLite for recall

| Directory                                                        | Description                                                            |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------- |
| [`src/services/routing/`](src/services/routing/)                 | Valhalla client, park-and-ride service, route history persistence      |
| [`src/components/navigation/`](src/components/navigation/)       | NextTurnBanner, EtaDisplay, ManeuverList, RoutePreview UI              |
| [`src/stores/navigationStore.ts`](src/stores/navigationStore.ts) | Active route, maneuvers, step index, ETA, rerouting state              |
| [`src/utils/routeSnap.ts`](src/utils/routeSnap.ts)               | GPS-to-polyline snap, bearing, remaining distance, off-route detection |
| [`src/utils/polyline.ts`](src/utils/polyline.ts)                 | Valhalla precision-6 encoded polyline decoder                          |

> **Deep dive →** [src/services/routing/README.md](src/services/routing/README.md)

---

### 6. Public Transit

Multi-modal transit layer with route line rendering, stop departures, and trip planning via OpenTripPlanner.

- **Transit line fetcher** — fetches route geometries from OTP endpoints (primary) or Overpass API (fallback) with spatial 0.05° tile caching
- **Stop enrichment** — on-tap Overpass query finds routes passing within 500m of a stop; cached per-stop coordinates
- **Departure times** — MBTA real-time predictions where available; estimated headway-based departures elsewhere
- **OTP trip planning** — multi-modal transit trips via OTP2 GTFS GraphQL queries with automatic endpoint selection by geographic region
- **Amtrak & MBTA** — dedicated fetchers for Amtrak national routes (BTS ArcGIS) and Boston-area real-time transit (MBTA V3 API)
- **Endpoint registry** — static registry mapping geographic bounding boxes to public OTP deployments (REST v1, GTFS GraphQL v2, Transmodel v3, MBTA v3)

| Directory                                                      | Description                                                                            |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [`src/services/transit/`](src/services/transit/)               | Line/stop/departure fetchers, OTP routing, endpoint registry, Amtrak/MBTA integrations |
| [`src/stores/transitStore.ts`](src/stores/transitStore.ts)     | Transit visibility, route lines, stops, selected stop, OTP itineraries                 |
| [`src/hooks/useTransitStops.ts`](src/hooks/useTransitStops.ts) | Viewport-based incremental transit line fetching with spatial cache restore            |

> **Deep dive →** [src/services/transit/README.md](src/services/transit/README.md)

---

### 7. Street-Level Imagery

Crowd-sourced street imagery capture, privacy-preserving blur, peer-to-peer sharing, and spatial browsing.

- **Capture** — camera viewfinder with 5s interval capture, GPS/heading/geohash metadata, and Schnorr-signed image records
- **Privacy blur** — face/license-plate detection placeholder (future on-device ML) via expo-image-manipulator
- **Upload pipeline** — blur → hash → append to Hypercore feed → sign metadata → publish to Gun.js for peer discovery
- **Browse** — query locally stored imagery by spatial proximity, geohash, or ID from the `street_imagery` SQLite table

| Directory                                            | Description                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------- |
| [`src/services/imagery/`](src/services/imagery/)     | Capture, blur, upload, and browse services for street-level imagery |
| [`src/components/imagery/`](src/components/imagery/) | Camera viewfinder, image viewer, and upload queue UI                |
| [`app/imagery/`](app/imagery/)                       | Capture and viewer screens                                          |

> **Deep dive →** [src/services/imagery/README.md](src/services/imagery/README.md)

---

### 8. Offline Regions

Downloadable region packs with vector tiles, Overture places, routing, and geocoding data — seeded to the P2P network via Hyperdrive.

- **Region catalog** — master JSON catalog from CDN, cached in MMKV for offline access, seeded into the local `regions` SQLite table
- **Download orchestration** — tiles from OpenFreeMap TileJSON, places from Overture GeoJSON, routing/geocoding assets, all with progress tracking
- **P2P seeding** — downloaded regions are seeded via Hyperdrive so other peers can download directly from your device
- **Overture import** — GeoJSON places bundled with a region are imported into the local `places` SQLite table
- **Connectivity awareness** — network quality monitoring (good/poor/none) via NetInfo for download scheduling

| Directory                                            | Description                                                                    |
| ---------------------------------------------------- | ------------------------------------------------------------------------------ |
| [`src/services/regions/`](src/services/regions/)     | Catalog, download, Overture import, region repository, connectivity monitoring |
| [`src/components/regions/`](src/components/regions/) | Region list, download progress, and management UI                              |
| [`app/regions/`](app/regions/)                       | Region management screen with catalog seeding, download, cancel/delete         |

> **Deep dive →** [src/services/regions/README.md](src/services/regions/README.md)

---

### 9. Identity & Security

Decentralized identity with secp256k1 keypair, Schnorr signatures for all user-generated data, and granular privacy consent.

- **Keypair generation** — `@noble/curves` secp256k1 with CSPRNG-backed random key, stored exclusively in `expo-secure-store` (iOS Keychain / Android Keystore)
- **Schnorr signing** — all POI edits, reviews, attestations, and traffic probes are signed with null-byte domain-separated payloads
- **Privacy consent** — versioned consent state for location, traffic telemetry, POI contributions, and imagery sharing; persisted in MMKV and applied to settings
- **Encrypted storage** — MMKV encryption key generated via `expo-crypto` and stored in secure store; all local data encrypted at rest

| Directory                                          | Description                                                         |
| -------------------------------------------------- | ------------------------------------------------------------------- |
| [`src/services/identity/`](src/services/identity/) | Keypair generation, Schnorr signing, and privacy consent management |
| [`src/services/storage/`](src/services/storage/)   | Encrypted MMKV singleton with secure-store-backed key               |
| [`src/services/database/`](src/services/database/) | SQLite schema initialization (WAL mode) for all local tables        |

> **Deep dive →** [src/services/identity/README.md](src/services/identity/README.md)

---

### 10. Map Rendering

MapLibre-based map with custom dark style, traffic overlays, POI badges, transit lines, and layer toggling.

- **MapLibre React Native** — vector tile rendering with OpenFreeMap tiles and custom Apple Maps–inspired dark style
- **Traffic overlay** — color-coded GeoJSON line layers for congestion visualization (green/yellow/orange/red/dark-red)
- **POI layer** — MarkerView-based pill badges with icon + label, spatial filtering, and category-colored backgrounds
- **Transit layer** — always-mounted GeoJSON layers for route lines and stops with visibility toggling (no GPU re-upload on toggle)
- **Layer control** — traffic, satellite, transit, and POI layers toggled via the map store

| Directory                                          | Description                                                                   |
| -------------------------------------------------- | ----------------------------------------------------------------------------- |
| [`src/components/map/`](src/components/map/)       | MapView, TrafficOverlay, TrafficRouteLayer, POILayer, TransitLayer components |
| [`src/services/map/`](src/services/map/)           | Local tile server management and style URL generation                         |
| [`src/constants/`](src/constants/)                 | Dark map style JSON, theme colors, and app configuration                      |
| [`src/stores/mapStore.ts`](src/stores/mapStore.ts) | Viewport, selected location, layer toggles, camera control                    |

> **Deep dive →** [src/components/map/README.md](src/components/map/README.md)

---

### 11. Place Lists & Favorites

User-curated place lists with multi-format import, iCloud sync, and MMKV persistence.

- **Place lists** — full CRUD with cross-list move, MMKV persistence, and sort by recent/name/distance
- **Multi-format import** — CSV, JSON, GeoJSON, KML/KMZ, GPX from Google Maps Takeout and third-party tools with URL coordinate extraction
- **iCloud sync** — iOS-only Key-Value storage bridge via native `PolarisCloudStore` module; pull on mount, debounce-push on change, merge on iCloud update
- **Favorites** — Home, Work, and pinned locations with ordering logic

| Directory                                                      | Description                                                    |
| -------------------------------------------------------------- | -------------------------------------------------------------- |
| [`src/services/places/`](src/services/places/)                 | Multi-format place list import (CSV, JSON, GeoJSON, KML, GPX)  |
| [`src/services/favorites/`](src/services/favorites/)           | MMKV-backed Home/Work/pinned favorites                         |
| [`src/services/icloud/`](src/services/icloud/)                 | iCloud Key-Value sync bridge for place lists                   |
| [`src/stores/placeListStore.ts`](src/stores/placeListStore.ts) | MMKV-persisted place lists with CRUD, import, and iCloud merge |
| [`app/places/`](app/places/)                                   | Place list detail screen with sort, edit, and navigate-to-map  |

> **Deep dive →** [src/services/places/README.md](src/services/places/README.md)

---

### 12. CarPlay Integration

CarPlay dashboard for navigation state, search, and maneuver display.

- **Navigation sync** — mirrors active route maneuvers and ETA to CarPlay templates in real time
- **Search forwarding** — CarPlay search queries routed through the unified search pipeline
- **Lifecycle management** — handles CarPlay connect/disconnect events and template state

| Directory                                        | Description                                                     |
| ------------------------------------------------ | --------------------------------------------------------------- |
| [`src/services/carplay/`](src/services/carplay/) | CarPlay manager syncing navigation state, search, and lifecycle |

> **Deep dive →** [src/services/carplay/README.md](src/services/carplay/README.md)

---

### 13. OSM Editing

Direct OpenStreetMap editing with OAuth 2.0 authentication and changeset management.

- **OAuth 2.0 + PKCE** — OSM authentication via expo-web-browser with `write_api` scope, tokens in secure store
- **Node editing** — fetch current OSM node state, edit 10+ tag fields (name, phone, website, hours, cuisine, wheelchair, Wi-Fi, outdoor seating), submit changesets
- **Changeset lifecycle** — create → update elements → close, using OSM API v0.6 with Bearer token

| Directory                                                  | Description                                                      |
| ---------------------------------------------------------- | ---------------------------------------------------------------- |
| [`src/services/osm/`](src/services/osm/)                   | OSM OAuth 2.0 auth service and API v0.6 editing client           |
| [`app/poi/osm-edit.tsx`](app/poi/osm-edit.tsx)             | OSM node editing screen with field form and changeset submission |
| [`src/stores/osmAuthStore.ts`](src/stores/osmAuthStore.ts) | OAuth token persistence, user profile, login/logout              |

> **Deep dive →** [src/services/osm/README.md](src/services/osm/README.md)

---

### 14. P2P Node Dashboard

Visualization of the device's role in the decentralized network.

- **Network stats** — active Hyperswarm/Nostr peers, syncing feeds, data served, cache utilization
- **Node status** — online/offline indicator, uptime tracking, region seed count
- **Resource usage** — current storage/bandwidth/battery usage against user-configured limits

| Directory                                                | Description                                  |
| -------------------------------------------------------- | -------------------------------------------- |
| [`src/components/dashboard/`](src/components/dashboard/) | NodeDashboard and MetricCard components      |
| [`src/stores/peerStore.ts`](src/stores/peerStore.ts)     | Local node info, active peers, syncing feeds |

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Expo Router (app/)             React Native UI          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐  │
│  │  (tabs)  │  │   poi/   │  │ regions/ │  │imagery/│  │
│  └──────────┘  └──────────┘  └──────────┘  └────────┘  │
├─────────────────────────────────────────────────────────┤
│  Component Layer (src/components/)                       │
│  map/ · navigation/ · search/ · poi/ · regions/         │
│  imagery/ · dashboard/ · places/ · common/              │
├─────────────────────────────────────────────────────────┤
│  State Layer (Zustand stores)                            │
│  mapStore · trafficStore · osmPoiStore · navigationStore │
│  transitStore · poiStore · placeListStore · peerStore    │
├─────────────────────────────────────────────────────────┤
│  Service Layer (src/services/)                           │
│  traffic/ · routing/ · geocoding/ · poi/ · search/      │
│  transit/ · imagery/ · regions/ · sync/ · identity/     │
│  osm/ · carplay/ · places/ · favorites/ · icloud/       │
├─────────────────────────────────────────────────────────┤
│  Utility Layer (src/utils/)                              │
│  etaCalculator · routeSnap · poiSpatialFilter           │
│  geohash · polyline · poiCategories · units             │
├─────────────────────────────────────────────────────────┤
│  Native / P2P Bridge                                     │
│  nodejs-assets/ ← Hyperdrive · tar/gunzip               │
│  backend/       ← Hyperswarm (Bare worklet)              │
│  Gun.js         ← CRDT sync for edits/reviews            │
├─────────────────────────────────────────────────────────┤
│  External APIs                                           │
│  TomTom · HERE · Valhalla · Overpass · Nominatim         │
│  Photon · MapKit · OTP · MBTA · Amtrak · Nostr relays   │
└─────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer      | Technology                                                 |
| ---------- | ---------------------------------------------------------- |
| Framework  | React Native 0.76.9 + Expo SDK 52 (bare workflow)          |
| Language   | TypeScript 5.6.3 (strict)                                  |
| Navigation | Expo Router 4 + React Navigation 7                         |
| Maps       | MapLibre React Native 10 (alpha) + OpenFreeMap tiles       |
| State      | Zustand 5                                                  |
| Storage    | expo-sqlite (FTS5) · react-native-mmkv · expo-secure-store |
| Identity   | @noble/curves secp256k1 · @noble/hashes SHA-256            |
| P2P        | Hyperswarm · Hyperdrive · Hypercore · GunDB                |
| Traffic    | TomTom Traffic Flow v4 · HERE Traffic Flow v7              |
| Routing    | Valhalla (online)                                          |
| Geocoding  | expo-sqlite FTS5 local · Photon · Nominatim fallback       |
| Transit    | OpenTripPlanner · MBTA V3 · Amtrak BTS                     |
| Testing    | Jest 29 · @testing-library/react-native 12                 |
| Linting    | ESLint 9 flat config · Prettier                            |
| Commits    | Commitlint + Husky                                         |

---

## Project Structure

```
src/
  components/
    map/              MapView, TrafficOverlay, POILayer, TransitLayer
    navigation/       NextTurnBanner, EtaDisplay, ManeuverList
    search/           SearchBar, SearchResults, SearchHistory
    poi/              POIInfoCard, POI detail components
    regions/          Region list, download progress UI
    imagery/          Camera viewfinder, image viewer
    dashboard/        P2P NodeDashboard, MetricCard
    places/           Place list UI components
    common/           Button, Modal, ErrorBoundary, LoadingSpinner
  constants/          config.ts, theme.ts, darkMapStyle.ts
  contexts/           ThemeContext
  hooks/              useTrafficEta, useTransitStops, useICloudSync
  models/             traffic.ts, poi.ts, user.ts
  services/
    traffic/          TomTom/HERE fetchers, P2P probe collection, aggregation, merging
    geocoding/        FTS5 local search, GeoNames global geocoder, Nominatim
    search/           Unified search, query parser, Photon geocoder, ranker
    poi/              OSM/Overture fetchers, edits, reviews, attestation, reputation
    transit/          OTP routing, line/stop/departure fetchers, MBTA, Amtrak
    routing/          Valhalla client, park-and-ride, route history
    imagery/          Capture, blur, upload, browse services
    regions/          Catalog, download, Overture import, region repository
    sync/             Hyperdrive bridge, feed sync, offline queue, peer service
    identity/         Keypair, Schnorr signing, privacy consent
    osm/              OAuth 2.0 auth, OSM API v0.6 editing
    carplay/          CarPlay navigation sync and search
    places/           Multi-format place list import
    favorites/        Home/Work/pinned favorites (MMKV)
    icloud/           iCloud Key-Value sync bridge
    gun/              Gun.js initialization with MMKV adapter
    map/              Local tile server management
    storage/          Encrypted MMKV singleton
    database/         SQLite schema initialization
  stores/             10 Zustand stores (map, traffic, navigation, transit, poi, etc.)
  types/              modules.d.ts (ambient declarations)
  utils/              etaCalculator, routeSnap, poiSpatialFilter, geohash, polyline
app/
  (tabs)/             Map, Navigation, Search, Profile, My Places
  imagery/            Capture and viewer screens
  onboarding/         Privacy consent flow
  poi/                POI detail, edit, OSM edit, reviews
  regions/            Region management
  places/             Place list detail
  settings/           Resource limits, privacy, theme, units
nodejs-assets/nodejs-project/   Hyperdrive / tar / gunzip P2P sidecar
backend/                        Hyperswarm Bare worklet for traffic P2P
specs/                          Feature specifications, plans, and task lists
```

---

## Getting Started

### Prerequisites

- Node.js ≥ 20
- pnpm ≥ 9
- Xcode 16 (iOS) or Android Studio (Android)
- CocoaPods (iOS: `sudo gem install cocoapods`)

### Install

```bash
git clone https://github.com/nicepolarismaps/polaris-maps.git
cd polaris-maps
pnpm install
# iOS only
cd ios && pod install && cd ..
```

### Run

```bash
# iOS Simulator
pnpm ios

# Android Emulator
pnpm android

# Metro bundler only
pnpm start
```

---

## Environment Variables

Create a `.env` file in the project root (never commit it):

```env
EXPO_PUBLIC_TOMTOM_API_KEY=your_tomtom_key
EXPO_PUBLIC_HERE_API_KEY=your_here_key
EXPO_PUBLIC_TOMTOM_PROXY_URL=https://your-proxy-server/tomtom   # optional — preferred over direct key
```

---

## Testing

```bash
pnpm test                 # Unit tests (Jest)
pnpm test:integration     # Integration tests
pnpm test:benchmark       # Performance benchmarks
pnpm typecheck            # tsc --noEmit
pnpm lint                 # ESLint
pnpm check                # All of the above
```

---

## Security

Full OWASP Top 10:2025 audit with 50 regression tests. See the [Security Review](SECURITY.md) for detailed findings, fixes, and reproduction steps.
