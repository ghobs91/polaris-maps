# Research: Decentralized P2P Mapping Platform (Polaris Maps)

**Phase**: 0 — Research  
**Feature**: `001-p2p-depin-mapping`  
**Date**: 2026-03-05  
**Input**: Technical Context from plan.md + user-provided architecture details

---

## Topic 1: PMTiles + MapLibre on React Native

### Decision

Use a lightweight local HTTP server (e.g., `react-native-static-server` or a custom `GCDWebServer`/`NanoHTTPD` bridge) to serve cached PMTiles files to MapLibre via `localhost` URLs. For remote tiles not yet cached, configure MapLibre's tile source to point at an Arweave gateway URL with PMTiles HTTP range request support. The PMTiles JS library's `addProtocol` API is not available in native MapLibre (only in MapLibre GL JS for web) — the native SDK requires a standard `{z}/{x}/{y}` tile URL or MBTiles source.

### Rationale

- `@maplibre/maplibre-react-native` wraps the native MapLibre SDKs (iOS: MapLibre Native, Android: MapLibre Android). These do not support the `addProtocol` extension that the JS library offers.
- The local HTTP server approach is proven in production by apps like Organic Maps and MapTiler. It translates PMTiles range requests into standard tile responses MapLibre can consume.
- Pre-converting PMTiles → MBTiles was considered but rejected because PMTiles is more bandwidth-efficient for partial downloads (only needed tiles fetched via range requests from Arweave).

### Alternatives Considered

| Alternative                                 | Rejected Because                                                                                                                    |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `addProtocol` in native MapLibre            | Not supported — only available in MapLibre GL JS (web)                                                                              |
| Pre-convert PMTiles → MBTiles on-device     | Requires downloading entire archive before any tiles display; defeats on-demand loading                                             |
| Direct Arweave gateway as MapLibre tile URL | Arweave gateways support range requests but MapLibre native needs `{z}/{x}/{y}` tile endpoints, not PMTiles range requests directly |
| Custom native tile source plugin            | Too much platform-specific work; local HTTP server is simpler and cross-platform                                                    |

### Key Implementation Details

- Local tile server runs on a random high port (`localhost:PORT`), started on app launch
- Server reads PMTiles index from cached file, resolves tile requests by byte-range seek
- MapLibre style JSON references `http://localhost:{PORT}/{source}/{z}/{x}/{y}.mvt` for vector tiles
- When a tile is not in local cache, server proxies the range request to Arweave gateway, caches the response, then returns it
- Region download pre-fetches entire PMTiles archive for a bounding box and stores it in the app's document directory

---

## Topic 2: Valhalla as React Native Native Module

### Decision

Compile Valhalla as a static library for iOS (arm64) and Android (arm64-v8a) and expose it to React Native via a Turbo Native Module (C++ shared via JSI). Use Valhalla's `actor_t` C++ API directly for route computation, avoiding the HTTP server wrapper entirely. Routing graph tiles are stored as flat files in the app's document directory, loaded by Valhalla at query time.

### Rationale

- Valhalla is the most capable open-source routing engine with costing profiles for driving, walking, cycling, and multimodal. OSRM is faster for pre-computed routes but lacks real-time costing flexibility needed for traffic-aware rerouting.
- There is no existing React Native bridge; it must be built. However, Valhalla has been successfully compiled for iOS and Android in projects like `valhalla-mobile` (Stadia Maps) and `mapbox-navigation-native` (which uses a modified Valhalla fork).
- JSI/Turbo Module approach avoids JSON serialization overhead of the old bridge — critical for sub-second routing.

### Alternatives Considered

| Alternative          | Rejected Because                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| OSRM native module   | OSRM uses pre-computed contraction hierarchies — cannot dynamically adjust for live traffic costing without full re-contraction |
| GraphHopper (Java)   | Android-native only; iOS would require separate implementation                                                                  |
| BRouter              | Primarily cycling-focused; limited driving/walking costing profiles                                                             |
| Server-side Valhalla | Violates zero-infrastructure constraint                                                                                         |

### Key Implementation Details

- **Binary size**: ~20-30 MB per platform (stripped, LTO-enabled). Acceptable for a mapping app.
- **Graph tile size**: A US metro area (e.g., Los Angeles county) is ~150-250 MB of Valhalla tiles. Stored on Arweave as a tar.gz archive (~60-100 MB compressed), downloaded once per region.
- **Route computation**: 100ms-500ms for short urban routes (<20km), 500ms-2s for medium routes (20-100km), up to 3s for cross-state routes on mid-range devices. Acceptable per constitution (< 2s for ≤100km).
- **Rerouting**: Incremental reroute from deviation point takes 100-300ms (only recomputes from current position to destination). Meets the 3-second acceptance criteria.
- **Traffic integration**: Valhalla supports "live traffic" speed overrides per edge via a `traffic.tar` file or in-memory speed map. The traffic service updates this map from Waku probe data; Valhalla reads it on next route request.

---

## Topic 3: Waku v2 on React Native via nodejs-mobile

### Decision

Use **light-push + filter mode** (not full relay) for mobile devices. The app subscribes to traffic content topics filtered by geohash prefix and pushes its own probes to the nearest service node. nodejs-mobile-react-native spawns a separate Node.js thread (not a process) that runs the Waku light client. Communication between RN JS thread and nodejs-mobile uses a bidirectional event bridge (`nodejs.channel`).

### Rationale

- Full relay mode requires maintaining persistent connections to multiple peers, constant message forwarding, and significant bandwidth/battery overhead — unsuitable for mobile.
- Light-push + filter mode offloads the gossip protocol to service nodes (which any desktop user or dedicated node can run). Mobile devices only send and receive messages relevant to their geohash area.
- Waku v2 is production-proven by Status messenger, WalletConnect v2, and Railgun — all mobile applications.

### Alternatives Considered

| Alternative                              | Rejected Because                                                                                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full Waku relay on mobile                | Battery drain (continuous gossip), bandwidth (forwarding irrelevant messages), NAT traversal complexity                                           |
| libp2p GossipSub directly (without Waku) | Waku adds content topics, message-level encryption, and light protocol support on top of GossipSub — rebuilding these would be significant effort |
| MQTT broker                              | Requires a central broker server — violates zero-infrastructure constraint                                                                        |
| WebSocket pub/sub                        | Requires a central server                                                                                                                         |
| Nostr relays for traffic                 | Nostr's relay model is pull-based and higher-latency; not suitable for real-time streaming telemetry                                              |

### Key Implementation Details

- **Threading**: nodejs-mobile runs in an isolated V8 thread. The React Native Hermes engine and the Node.js V8 engine do not share memory. Communication is via string/JSON messages over `nodejs.channel.send()` / `nodejs.channel.on()`.
- **Content topics**: Traffic probes are published to `/polaris/1/traffic/{geohash6}/proto` where `{geohash6}` is a 6-character geohash (~1.2km × 0.6km cell). Devices subscribe to topics for geohash cells visible on their screen + adjacent cells.
- **Message format**: Protobuf-encoded `TrafficProbe { geohash: string, speed_kmh: float, bearing: uint16, timestamp: uint64, segment_id: string }`. ~40-60 bytes per message.
- **Publish rate**: One probe per 5 seconds while moving (>5 km/h). ~12 messages/minute/device.
- **Battery impact**: Light-push sends are fire-and-forget. Filter subscriptions receive only relevant messages. Expected battery overhead: <1% per hour.
- **Service nodes**: Any Polaris Maps desktop/full-node user can run a Waku relay service node. The protocol is self-sustaining — more users = more capacity.

---

## Topic 4: Gun.js on React Native

### Decision

Use Gun.js with MMKV as the storage adapter for Hermes compatibility. Gun.js **requires at least one relay peer for initial discovery** — this is NOT a true DHT. Use a public Gun relay list (community-maintained) for bootstrap; any Polaris Maps user can also run a relay by enabling "full node" mode. POI data uses Gun's SEA (Security, Encryption, Authorization) module with Nostr keypair-derived Gun keys for signed writes.

### Rationale

- Gun.js provides CRDT-based conflict resolution (HAM — Hypothetical Amnesia Machine) out of the box, which is ideal for concurrent POI edits from multiple users. No custom merge logic needed.
- Gun.js works in React Native with Hermes after applying WebSocket and `crypto` polyfills (`react-native-get-random-values`, `react-native-webrtc`).
- The relay peer requirement is acceptable because ANY user can be a relay — it's not developer infrastructure.

### Alternatives Considered

| Alternative               | Rejected Because                                                                                                                        |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| OrbitDB (IPFS-based CRDT) | Requires IPFS daemon — too heavy for mobile, significant battery/bandwidth                                                              |
| Automerge + custom sync   | No built-in networking — would need to build sync protocol from scratch                                                                 |
| Y.js + WebRTC             | Requires WebRTC signaling server (central infrastructure)                                                                               |
| Plain Hypercore Autobase  | API still in flux; no built-in graph query semantics; better suited for append-only logs than a POI database with random access queries |

### Key Implementation Details

- **Hermes compatibility**: Requires polyfills: `react-native-get-random-values` (for `crypto.getRandomValues`), `text-encoding-polyfill` (for `TextEncoder`), and a WebSocket polyfill if the built-in one is insufficient.
- **Storage adapter**: MMKV adapter via `gun-mmkv` or custom adapter wrapping `react-native-mmkv`. MMKV is 10-100x faster than AsyncStorage for the small key-value writes Gun generates.
- **Data model**: POI records keyed by `poi/{geohash8}/{uuid}`. Reviews keyed by `review/{poi_uuid}/{author_pubkey}`. Reputation keyed by `reputation/{pubkey}`.
- **Relay peers**: On app launch, Gun connects to 2-3 relay peers from a hardcoded + dynamically-updated list. Relay peers are community-operated — any Polaris desktop user can expose their Gun instance as a relay.
- **Conflict resolution**: If User A sets `hours: "9am-5pm"` and User B sets `hours: "9am-6pm"` simultaneously, HAM uses vector clocks to deterministically pick the "later" write. For contested fields, the UI can show both values and let reputation weighting determine the displayed default.

---

## Topic 5: Hypercore / react-native-bare-kit

### Decision

Use react-native-bare-kit for Hypercore-based sync of large binary datasets (routing graph deltas, offline region manifests). **Autobase (multi-writer) should be treated as experimental** — use single-writer Hypercore feeds for data distribution and reserve Autobase for POI contribution aggregation only after validating stability. The primary role of Hypercore in the initial release is efficient delta-sync of routing graph updates and region data, not real-time collaborative editing (which Gun.js handles).

### Rationale

- react-native-bare-kit is developed by Holepunch (the Hypercore team) and ships in their Keet messaging app — it is functional on iOS and Android, though third-party documentation is limited.
- Hypercore's append-only log with sparse replication is ideal for distributing routing graph delta-updates: each update is an append, and devices only download the entries they're missing.
- Autobase multi-writer is undergoing active API changes (as of 2025). Using it for the mutable POI layer alongside Gun.js would create redundancy and instability. Better to let Gun.js handle the POI CRDT layer and use Hypercore for the distribution/sync layer only.

### Alternatives Considered

| Alternative             | Rejected Because                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| IPFS for binary sync    | IPFS daemon is too resource-intensive for mobile; content routing is slow for large files                                                  |
| BitTorrent/WebTorrent   | No incremental/delta sync — must re-download entire file on updates                                                                        |
| Plain HTTP from Arweave | No delta sync — entire archive must be re-downloaded for any update; Arweave is ideal for immutable base data but not for frequent updates |
| Gun.js for binary data  | Gun.js is designed for small JSON documents, not multi-MB binary blobs                                                                     |

### Key Implementation Details

- **Bare runtime**: react-native-bare-kit embeds a minimal "Bare" runtime (C-based, not Node.js) that runs Hypercore natively. It operates in a separate thread, similar to nodejs-mobile.
- **DHT discovery**: Hypercore uses the Hyperswarm DHT for peer discovery with built-in NAT traversal (hole punching via STUN-like mechanism). Works on mobile but may struggle behind symmetric NATs (carrier-grade NAT). Fallback: relay through reachable peers.
- **Feed structure**: One Hypercore feed per region per data type (e.g., `routing-graph/us-ca-la`, `region-manifest/us-ca-la`). Feeds are append-only; new graph tile versions are appended as entries.
- **Sync performance**: Hypercore's sparse replication means devices only download new entries since their last sync. A routing graph delta for a metro area is typically 1-10 MB. Sync completes in seconds over LTE.
- **Discovery key sharing**: Feed discovery keys are published on Arweave as a manifest, so devices know which feeds to join for their region.

---

## Topic 6: On-Device Geocoding (Pelias Extracts in SQLite FTS5)

### Decision

Build custom geocoding index from Overture Maps + OSM address data, stored in SQLite with FTS5 for forward geocoding and an R-tree spatial index for reverse geocoding. The data is packaged per region, stored on Arweave, and downloaded on demand. Do NOT use a full Pelias stack (Elasticsearch-based) — instead, create a mobile-optimized extract pipeline that outputs SQLite databases.

### Rationale

- Pelias is an Elasticsearch-based geocoder — it cannot run on mobile. However, its data processing pipeline (openaddresses importer, OSM importer, etc.) can be used offline to generate address datasets that are then indexed into SQLite.
- SQLite FTS5 provides excellent full-text search performance on mobile (5-30ms per query) with a tiny footprint.
- R-tree spatial indexes in SQLite are built-in and provide <10ms reverse geocoding lookups.

### Alternatives Considered

| Alternative                           | Rejected Because                                                  |
| ------------------------------------- | ----------------------------------------------------------------- |
| Full Pelias (Elasticsearch) on-device | Impossible — Elasticsearch requires a JVM and gigabytes of memory |
| Photon geocoder                       | Still requires a Lucene/ES backend; not mobile-compatible         |
| Nominatim                             | PostgreSQL-backed; cannot run on mobile                           |
| Pre-computed geocoding JSON files     | No ranked search capability; slow linear scan on large datasets   |

### Key Implementation Details

- **Index structure**:
  - `addresses` table: `id, text (FTS5-indexed), lat, lng, housenumber, street, city, state, postcode, country`
  - `places` table: `id, name (FTS5-indexed), category, lat, lng, geohash`
  - `spatial_index`: R-tree index on `(lat_min, lat_max, lng_min, lng_max)` covering both tables
- **Metro area extract size**: 50-200 MB per major metro area (e.g., LA: ~150 MB). Compressed on Arweave: ~40-80 MB.
- **FTS5 query performance**: Prefix queries (`coffee*`) return ranked results in 5-30ms on mid-range devices. Exact address lookups in 1-5ms.
- **Reverse geocoding**: R-tree range query for nearby entities within a small bounding box, then distance sort. Typical latency: 1-10ms.
- **Generation pipeline**: Offline script processes Overture Places + OSM addresses → SQLite database → compressed → uploaded to Arweave. Run periodically (monthly) to update the dataset.

---

## Topic 7: Nostr Keypair Identity on React Native

### Decision

Use `@noble/curves` (by Paul Miller) for secp256k1 key generation and Schnorr signing (NIP-01). Store the private key in `expo-secure-store` (which maps to iOS Keychain and Android Keystore). Derive a Gun.js-compatible key from the same Nostr keypair to unify identity across both systems.

### Rationale

- `@noble/curves` is a pure-JS, audited, zero-dependency cryptography library that works in any JS runtime including Hermes. It supports both ECDSA and Schnorr signatures on secp256k1 — the latter is required for Nostr NIP-01.
- `expo-secure-store` provides a simple API for secure storage that maps to platform-native secure enclaves without requiring custom native modules.

### Alternatives Considered

| Alternative                             | Rejected Because                                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `react-native-secp256k1` (native)       | Adds native build complexity; pure-JS solution is fast enough for signing (few ms per signature) |
| `ethers.js` secp256k1                   | Massive dependency (full Ethereum library) for just key management                               |
| Generating separate Gun.js + Nostr keys | Two key pairs = two identities = confusing for users and harder to verify                        |

### Key Implementation Details

- **Key generation**: `@noble/curves/secp256k1` → `schnorr.getPublicKey(privateKey)` for Nostr pubkey (32-byte x-only). Generated on first launch.
- **Storage**: `expo-secure-store.setItemAsync('nostr_privkey', hex)` — encrypted at rest by OS.
- **NIP-01 signing**: Event structure `{ pubkey, created_at, kind, tags, content }` → SHA-256 hash → Schnorr sign. Kind 30078 for POI contributions (parameterized replaceable event).
- **Gun.js key derivation**: Derive a Gun SEA keypair from the Nostr private key using HKDF so that Gun attestations are traceable to the same Nostr identity.
- **Backup**: Users can export their Nostr private key (nsec format) for backup/migration. Standard Nostr clients can verify their contributions.

---

## Topic 8: Arweave as Permanent Storage

### Decision

Use Arweave for all immutable base data (PMTiles archives, Valhalla routing graphs, geocoding SQLite databases). Read access is free via any ar.io gateway. Versioning uses Arweave manifest transactions with GraphQL-queryable tags for data type, region, and version number.

### Rationale

- Arweave provides permanent, decentralized storage with free reads — ideal for base map data that must be available even if the developer disappears.
- ar.io gateways support HTTP range requests, which is essential for PMTiles and large file downloads.
- Upload cost is a one-time payment (~$1-5 per GB at current rates), making it economically viable for map data that changes infrequently (monthly updates).

### Alternatives Considered

| Alternative                     | Rejected Because                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------- |
| IPFS + Filecoin                 | Filecoin storage deals expire; IPFS data disappears when no node pins it; no permanence guarantee |
| BitTorrent                      | No permanence — data only available while seeders exist                                           |
| Centralized CDN (Cloudflare R2) | Requires developer-operated infrastructure; violates zero-infrastructure constraint               |
| Bundlr/Irys (Arweave L2)        | Adds turbo-charging benefits but another dependency; direct Arweave L1 is simpler and sufficient  |

### Key Implementation Details

- **Read access**: Any ar.io gateway: `https://{gateway}/raw/{txId}` for raw file access, `https://{gateway}/{txId}/{path}` for manifest paths. Gateways are operated by the ar.io network — not developer-controlled.
- **Range requests**: ar.io gateways support `Range: bytes=X-Y` HTTP headers. PMTiles directory lookups and partial tile fetches work as expected. Latency: 50-200ms for first byte (varies by gateway), subsequent requests benefit from CDN caching.
- **Upload cost**: ~$0.50-2.00 per 100 MB (varies with AR token price and network demand). A full US coverage dataset (PMTiles + routing graphs + geocoding indexes) might be 5-20 GB → $25-200 one-time.
- **Versioning strategy**:
  1. Each dataset version is a new Arweave transaction with tags: `{ "App-Name": "polaris-maps", "Data-Type": "pmtiles"|"routing-graph"|"geocoding-index", "Region": "us-ca-la", "Version": "2026-03" }`.
  2. A manifest transaction acts as a directory, mapping region names to the latest data transaction IDs.
  3. The app queries `https://{gateway}/graphql` with tag filters to discover the latest manifest, then resolves individual file IDs.
  4. Old versions remain permanently accessible for rollback or historical reference.
- **Gateway fallback**: App ships with a list of 5+ ar.io gateways and health-checks them on launch. If one is slow or down, it falls back to the next.

---

## Summary Comparison Matrix

| Component         | Technology                             | Maturity                        | Mobile Readiness     | Risk Level |
| ----------------- | -------------------------------------- | ------------------------------- | -------------------- | ---------- |
| Map rendering     | MapLibre + local PMTiles server        | High                            | Proven               | Low        |
| Tile storage      | Arweave (PMTiles)                      | Medium                          | Works via HTTP       | Low        |
| Routing engine    | Valhalla native module                 | High (engine) / Low (RN bridge) | Must build bridge    | Medium     |
| Real-time traffic | Waku v2 light client via nodejs-mobile | Medium                          | Production (Status)  | Medium     |
| POI database      | Gun.js + Hermes polyfills              | Medium                          | Works with polyfills | Medium     |
| Data sync         | Hypercore / bare-kit                   | Low-Medium                      | Used by Keet         | High       |
| Geocoding         | Custom SQLite FTS5 indexes             | High (SQLite)                   | Proven               | Low        |
| Identity          | Nostr keypair (noble/curves)           | High                            | Pure JS              | Low        |
| State management  | Zustand + MMKV + SQLite                | High                            | Proven               | Low        |

### Highest-Risk Items (require early prototyping)

1. **Valhalla native module bridge** — No existing RN bridge; must compile C++ and write JSI bindings. Prototype first.
2. **react-native-bare-kit (Hypercore)** — Limited third-party documentation; Autobase API instability. Validate basic feed replication on both platforms early.
3. **nodejs-mobile + Waku** — Threading model and memory overhead need empirical validation on mid-range Android devices.

### Recommended Prototyping Order

1. MapLibre + local PMTiles tile server (proves core map rendering)
2. Valhalla C++ compilation + JSI bridge (proves on-device routing)
3. nodejs-mobile + Waku light client (proves real-time traffic pipeline)
4. Gun.js + Hermes polyfills + MMKV adapter (proves POI sync)
5. Hypercore bare-kit feed replication (proves delta-sync)
6. SQLite FTS5 geocoding (low risk — prove last)
