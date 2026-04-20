<div align="center">

# Polaris Maps

**A maps app where every phone is a node, not just a client.**

Turn-by-turn navigation, live traffic, POI search, transit, offline maps — built on a peer-to-peer network instead of a corporate cloud.

[Features](#features) · [How It Works](#how-the-p2p-layer-works) · [Architecture](#architecture) · [Getting Started](#getting-started)

</div>

---

## Why Polaris?

Google Maps and Apple Maps are remarkable products — but they work by funneling the world's location data through a single company's servers. Polaris Maps inverts that model. Your device doesn't just _consume_ map data; it _contributes_ it. Traffic speeds, place information, map tiles, street imagery — all shared directly between devices over an encrypted peer-to-peer mesh.

The result is a mapping app that gets better the more people use it, where no company owns the data, and where the whole thing keeps working even when the internet doesn't.

---

## Features

### Navigation & Routing

Turn-by-turn directions via [Valhalla](https://github.com/valhalla/valhalla) with GPS snap-to-route, off-route detection, automatic rerouting, and park-and-ride suggestions that combine driving + transit. Route ETAs adjust in real time based on live traffic from both commercial feeds and peer-reported congestion.

### Live Traffic

Color-coded congestion overlays fused from three sources: TomTom, HERE, and crowd-sourced speed probes broadcast by nearby peers. Your phone passively contributes anonymous speed data on geohash topic channels; the network merges it all into a unified picture. When congestion adds 25%+ delay to your route, Polaris reroutes automatically.

### Places & POI

A 3-phase search that returns results in milliseconds: local Overture Maps SQLite first, then parallel Overpass + Overture network queries, then Nominatim fallback. Apple MapKit enriches selected POIs with phone, hours, and photos on iOS. Zoom-adaptive spatial filtering keeps the map readable at every zoom level.

### Search

Natural-language queries ("coffee shops open now near me") are parsed for brand, cuisine, and modifier hints, then run in parallel across local FTS5 indexes, Photon geocoding, Overpass, and address search. Results are deduplicated and scored 0–100 by distance, name similarity, category match, and popularity.

### Public Transit

Multi-modal trip planning via OpenTripPlanner with route line rendering, stop departures, and dedicated integrations for Amtrak and MBTA. An endpoint registry maps geographic regions to the correct OTP deployment automatically.

### Offline Regions

Download region packs (vector tiles, Overture places, routing graphs, geocoding indexes) and use them without connectivity. Downloaded regions are automatically seeded back to the P2P network so nearby peers can grab them from you instead of a CDN.

### Street-Level Imagery

Capture geotagged street photos with automatic interval shooting, privacy blur, and Schnorr-signed metadata. Images are appended to your Hypercore feed and discoverable by other peers through Gun.js spatial queries.

### Place Lists & Favorites

Curate place lists with full CRUD, import from Google Maps Takeout (CSV, JSON, GeoJSON, KML, GPX), sync across iOS devices via iCloud, and set Home/Work favorites.

### OSM Editing

Edit OpenStreetMap directly — OAuth 2.0 + PKCE login, fetch live node state, edit tags (name, hours, wheelchair access, Wi-Fi, cuisine, etc.), and submit changesets via OSM API v0.6.

### CarPlay

Navigation state, maneuvers, and search forwarded to CarPlay templates in real time.

---

## How the P2P Layer Works

Polaris treats every running instance as a **node** in a decentralized physical infrastructure network (DePIN). There are three interlocking P2P systems, each chosen for what it does best:

### Hyperswarm — Real-Time Peer Discovery

```
Your phone                           Nearby phones
    │                                     │
    ├─ SHA-256(geohash4) ──► topic ◄── SHA-256(geohash4) ─┤
    │      "u4pr"                "u4pr"                    │
    │                                     │
    └──── encrypted connection ◄──────────┘
              (traffic probes, POI updates)
```

[Hyperswarm](https://docs.holepunch.to/building-blocks/hyperswarm) runs inside a [Bare](https://bare.pears.com/) worklet via `react-native-bare-kit`, giving us a full DHT-based peer discovery layer on a phone. Devices join **geohash4 topic channels** (~39 km cells) — if you're in the same metro area, you'll find each other.

Once connected, peers exchange **traffic probes** (anonymous GPS-derived speed packets), POI edits, and attestations over encrypted streams. Communication is bidirectional and direct — no relay server in the loop.

When Hyperswarm peer count drops below 3, Polaris seamlessly falls back to **Nostr relays** (event kind `20100`) to maintain data flow with full Schnorr signature verification. The network degrades gracefully rather than failing.

### Hyperdrive — File Replication

When you download a region pack (tiles, routing graphs, place data), your device starts **seeding it via Hyperdrive** — the same way a BitTorrent client seeds after downloading. Other nearby peers can then download the region directly from you rather than hitting a CDN.

This creates an organic content delivery network where popular regions (say, the SF Bay Area) are served by dozens of local devices, while the CDN only handles cold starts for rarely-requested areas.

A Node.js sidecar process ([`nodejs-assets/`](nodejs-assets/nodejs-project/)) manages Hyperdrive feeds, tar extraction, and bridge IPC with the React Native layer.

### Gun.js — Conflict-Free Data Sync

[Gun.js](https://gun.eco/) handles all structured data that needs eventual consistency across the network: POI edits, reviews, ratings, attestations, and reputation scores. Its CRDT (Conflict-free Replicated Data Type) model means two users can edit the same café's hours simultaneously without conflicts — both edits merge deterministically.

Gun runs with an MMKV storage adapter for fast local persistence and discovers relay peers automatically for data propagation beyond the local swarm.

### Identity Without Accounts

There are no usernames, passwords, or account servers. On first launch, Polaris generates a **secp256k1 keypair** using a cryptographic random number generator and stores it in the OS secure enclave (iOS Keychain / Android Keystore). Your public key _is_ your identity.

Every action you take — editing a POI, submitting a review, broadcasting a traffic probe — is **Schnorr-signed** with your private key. Other peers can verify authorship without trusting any central authority. Reputation scores are computed from your contribution history (edits, confirmations, traffic probe accuracy) and stored in Gun.js with signature verification.

**Proof-of-presence attestation** lets you cryptographically prove you were within 100 meters of a POI — confirming a business exists at its claimed location without revealing your exact position.

### Offline Resilience

All outbound actions (probes, edits, reviews) are queued in MMKV (capped at 500 entries) when offline and replayed automatically when connectivity returns. Combined with offline region packs and local FTS5 search, Polaris is fully functional without an internet connection — and catches back up when you're online.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Expo Router (app/)             React Native UI          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐  │
│  │  (tabs)  │  │   poi/   │  │ regions/ │  │imagery/│  │
│  └──────────┘  └──────────┘  └──────────┘  └────────┘  │
├─────────────────────────────────────────────────────────┤
│  Components    src/components/                           │
│  map · navigation · search · poi · regions              │
│  imagery · dashboard · places · common                  │
├─────────────────────────────────────────────────────────┤
│  State         Zustand stores                            │
│  map · traffic · osmPoi · navigation                    │
│  transit · poi · placeList · peer                       │
├─────────────────────────────────────────────────────────┤
│  Services      src/services/                             │
│  traffic · routing · geocoding · poi · search           │
│  transit · imagery · regions · sync · identity          │
│  osm · carplay · places · favorites · icloud            │
├─────────────────────────────────────────────────────────┤
│  P2P Bridge                                              │
│  nodejs-assets/  → Hyperdrive (file replication)         │
│  backend/        → Hyperswarm  (Bare worklet, DHT)       │
│  Gun.js          → CRDT sync   (edits, reviews, rep)     │
├─────────────────────────────────────────────────────────┤
│  External APIs (fallback / enrichment)                   │
│  TomTom · HERE · Valhalla · Overpass · Nominatim         │
│  Photon · MapKit · OTP · MBTA · Amtrak · Nostr           │
└─────────────────────────────────────────────────────────┘
```

### Tech Stack

| Layer      | Technology                                                 |
| ---------- | ---------------------------------------------------------- |
| Framework  | React Native 0.76.9 + Expo SDK 52 (bare workflow)          |
| Language   | TypeScript 5.6.3 (strict)                                  |
| Navigation | Expo Router 4 + React Navigation 7                         |
| Maps       | MapLibre React Native 10 + OpenFreeMap tiles               |
| State      | Zustand 5                                                  |
| Storage    | expo-sqlite (FTS5) · react-native-mmkv · expo-secure-store |
| Identity   | @noble/curves secp256k1 · @noble/hashes SHA-256            |
| P2P        | Hyperswarm · Hyperdrive · Hypercore · Gun.js               |
| Traffic    | TomTom Traffic Flow v4 · HERE Traffic Flow v7              |
| Routing    | Valhalla (online + offline graph tiles)                    |
| Geocoding  | FTS5 local · Photon · Nominatim                            |
| Transit    | OpenTripPlanner · MBTA V3 · Amtrak BTS                     |
| Testing    | Jest 29 · @testing-library/react-native 12                 |

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
pnpm ios          # iOS Simulator
pnpm android      # Android Emulator
pnpm start        # Metro bundler only
```

### Environment Variables

Create a `.env` file in the project root (never commit):

```env
EXPO_PUBLIC_TOMTOM_API_KEY=your_tomtom_key
EXPO_PUBLIC_HERE_API_KEY=your_here_key
EXPO_PUBLIC_TOMTOM_PROXY_URL=https://your-proxy-server/tomtom   # optional
```

### Testing

```bash
pnpm test                 # Unit tests
pnpm test:integration     # Integration tests
pnpm test:benchmark       # Performance benchmarks
pnpm typecheck            # TypeScript
pnpm lint                 # ESLint
pnpm check                # All of the above
```

---

## Security

Full OWASP Top 10:2025 audit with 50 regression tests. See the [Security Review](SECURITY.md) for findings, fixes, and reproduction steps.

---

## License

[MIT](LICENSE)
