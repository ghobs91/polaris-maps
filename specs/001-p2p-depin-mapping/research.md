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

---

## Topic 9: Deep Dive — Waku vs Nostr vs Holepunch/Pears for Decentralized Traffic Flow Tracking

**Date**: 2026-04-10  
**Objective**: Determine whether Holepunch/Pears (Hyperswarm + Hypercore + Autobase) is a better foundation for a decentralized, mostly-P2P traffic flow tracking system than the current plan of Waku v2 light push/filter via nodejs-mobile, and whether Nostr relays could serve as a viable alternative.

### 9.1 Requirements Recap

The traffic flow system must:

1. **Ingest speed probes** from mobile devices (~40-60 byte protobuf, 1 per 5 seconds while moving)
2. **Distribute probes geographically** — devices only receive probes relevant to their viewport (~1-5 km radius)
3. **Sub-10-second latency** from probe publish to consumption by nearby peers
4. **Work on mobile** (iOS + Android, React Native, battery < 1% overhead/hour)
5. **Be mostly P2P** — no developer-hosted servers required for operation
6. **Handle cold-start** — work even when few peers are online in a given area
7. **Support aggregation** — raw probes must be aggregated into per-segment speed estimates for Valhalla traffic costing

---

### 9.2 Waku v2 — Deep Analysis

#### Architecture for Traffic

Waku uses a **pub/sub gossip relay network** (based on libp2p GossipSub) with a light client tier:

- Mobile devices use **Light Push** (fire-and-forget publish to a service node) and **Filter** (subscribe to content topics on a service node)
- Service nodes (full relay nodes) form the gossip backbone
- Content topics provide per-geohash routing: `/polaris/1/traffic/{geohash6}/proto`

#### Strengths

| Strength                                       | Detail                                                                                                                                                                  |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Purpose-built for ephemeral messaging**      | Messages are transient by design. The `ephemeral` flag on Waku messages tells relays not to store them — perfect for traffic probes that expire in minutes              |
| **Content topic filtering**                    | Native support for geohash-based topic partitioning. Mobile devices subscribe only to geohash cells they care about. Service nodes handle the routing                   |
| **Light client protocol is production-proven** | Status Messenger (millions of messages/day) uses the same light push/filter protocol on mobile                                                                          |
| **RLN (Rate Limit Nullifiers)**                | Built-in economic spam prevention via zero-knowledge proofs. Prevents a single bad actor from flooding the network with fake probes. Crucial for traffic data integrity |
| **No relay operator trust required**           | Messages are end-to-end verifiable via Nostr keypair signatures. Service nodes can't tamper with probes                                                                 |
| **Bandwidth-efficient on mobile**              | Light clients only send their own probes and receive filtered messages. No gossip forwarding duty                                                                       |

#### Weaknesses

| Weakness                                               | Detail                                                                                                                                                                                                                                                         |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Requires nodejs-mobile**                             | js-waku (now logos-delivery-js) is a pure TypeScript/JS implementation, but it depends on libp2p which requires a Node.js runtime. Cannot run directly in Hermes. nodejs-mobile adds ~30-50 MB to app size and spawns a separate V8 thread                     |
| **No official React Native SDK**                       | There is no `react-native-waku` package. The approach is DIY: run js-waku inside nodejs-mobile with a JSON message bridge to RN. Multiple developers (nicobao et al.) attempted React Native integrations but none shipped to production outside of Status     |
| **Service node dependency**                            | Light clients cannot function without at least one reachable service node. If no service nodes are online for a geohash region, probes are lost. Not truly P2P — it's a client/server model with decentralized servers                                         |
| **Cold-start problem**                                 | A new Polaris Maps deployment must either (a) ship hardcoded service node addresses or (b) rely on existing Waku network service nodes. The Waku network prioritizes messaging use cases — traffic probes at scale may not be welcome on shared infrastructure |
| **Latency unpredictability**                           | Light push → service node → gossip relay mesh → filter subscriber. Each hop adds latency. Under load, GossipSub heartbeats (1-second intervals) add buffering. Realistic: 1-5 seconds in good conditions, potentially 10+ seconds through multiple relay hops  |
| **js-waku repo recently renamed to logos-delivery-js** | Suggests organizational restructuring. The project was moved under the Logos umbrella (IFT). Ongoing but signals potential priority shifts                                                                                                                     |

#### Mobile Battery/Bandwidth Profile

- **Outbound**: 1 probe/5s × 60 bytes = 720 bytes/min = ~43 KB/hour
- **Inbound (filtering)**: Depends on peer density. 10 nearby peers × 12 msg/min × 60 bytes = ~430 KB/hour
- **Connection overhead**: Persistent WebSocket to service node. Keep-alive pings. ~50 KB/hour
- **Total**: ~500 KB - 1 MB/hour. Battery: < 1% on modern devices (comparable to a background chat app)

---

### 9.3 Nostr — Deep Analysis

#### Architecture for Traffic

Nostr uses **WebSocket connections to relay servers**. Clients publish signed events and subscribe via filters (REQ messages). The protocol is simple: JSON events with kind numbers, tags, and content.

A traffic probe would be a custom event kind (e.g., kind 30078 for app-specific data, or a new custom kind in the 20000-29999 ephemeral range):

```json
{
  "pubkey": "<hex>",
  "created_at": 1712764800,
  "kind": 20100,
  "tags": [
    ["g", "9q5ctr"],
    ["expiration", "1712765100"]
  ],
  "content": "<protobuf-base64-encoded-probe>",
  "id": "<event-id>"
}
```

Key NIPs relevant to traffic:

- **NIP-01**: Basic protocol, REQ/EVENT/CLOSE
- **NIP-40**: Expiration timestamps (relays MAY delete expired events) — probes expire after 5 minutes
- **NIP-52**: Geohash `g` tag for geospatial filtering — relays can filter by geohash prefix
- **Ephemeral events (kinds 20000-29999)**: Events not expected to be stored long-term

#### Strengths

| Strength                                  | Detail                                                                                                                                                                                        |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Extreme simplicity**                    | The protocol is just WebSocket + JSON + Schnorr signatures. No libp2p, no GossipSub, no DHT. A full client can be written in ~200 lines                                                       |
| **Already in the app**                    | Polaris already uses Nostr keypairs (NIP-01) for identity. The same keypair signs traffic probes. Zero additional cryptographic infrastructure                                                |
| **Geohash filtering via `g` tag**         | NIP-52 defines geohash tags. A relay can efficiently filter events by `#g` tag prefix. `REQ ["REQ", "traffic", {"kinds": [20100], "#g": ["9q5c"]}]` returns only probes in that geohash4 area |
| **Works directly in Hermes**              | Pure WebSocket connections — no nodejs-mobile, no libp2p, no extra runtime. The entire client is ~2 KB of JS. Eliminates 30-50 MB of nodejs-mobile overhead                                   |
| **Expiration (NIP-40)**                   | Probes tagged with `expiration` tell relays to garbage-collect them. Relays don't accumulate stale traffic data                                                                               |
| **Massive existing relay infrastructure** | Thousands of Nostr relays already exist. Traffic probes can piggyback on existing infrastructure, or dedicated "traffic relays" can be stood up                                               |
| **NIP-42 AUTH**                           | Relays can require authentication, allowing Polaris-specific relays to restrict traffic events to verified app users                                                                          |
| **Rich ecosystem of RN clients**          | Damus, Amethyst, Primal — all React Native or mobile-native. The protocol is proven on mobile                                                                                                 |

#### Weaknesses

| Weakness                               | Detail                                                                                                                                                                                                                                                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Relay-dependent (not P2P)**          | Nostr is fundamentally a **client-relay** architecture, not peer-to-peer. If all relays go offline, the network stops. This is a weaker decentralization guarantee than Waku or Hyperswarm                                                                                                                    |
| **Relay operators see content topics** | Relay operators can read traffic probes (they're signed but not encrypted). Privacy concern: relay operators can track user movement patterns. Mitigation: encrypt probe content, use geohash prefix only in tags                                                                                             |
| **No built-in spam prevention**        | Unlike Waku's RLN, Nostr has no protocol-level rate limiting. Must implement at the relay level (NIP-13 proof-of-work, or custom relay policies). A spammer can flood fake probes                                                                                                                             |
| **Latency model**                      | Client → relay is fast (WebSocket, ~50-200 ms). But the subscriber must also be connected to the **same relay** or a relay that mirrors the data. No automatic gossip between relays — each relay is independent. For coverage, clients must connect to multiple relays                                       |
| **No native pub/sub fan-out**          | Relays independently serve subscriptions. There's no relay-to-relay forwarding like GossipSub. If Device A publishes to Relay X and Device B subscribes to Relay Y, Device B never sees Device A's probe unless both relays are bridged or both devices connect to both relays                                |
| **Event overhead**                     | A Nostr event has JSON overhead: `pubkey` (64 hex chars), `id` (64 hex chars), `sig` (128 hex chars), `created_at`, `kind`, `tags`, `content`. A 60-byte probe becomes a ~400-500 byte JSON event after signing. ~8x overhead vs raw protobuf. At 12 events/min, this is still only ~360 KB/hour — acceptable |
| **Ephemeral events are advisory**      | Relays MAY store ephemeral events anyway. No guarantee of deletion. Not a functional issue, but a privacy concern                                                                                                                                                                                             |

#### Mobile Battery/Bandwidth Profile

- **Outbound**: 1 event/5s × 500 bytes (JSON) = 6 KB/min = ~360 KB/hour
- **Inbound**: 10 peers × 12 events/min × 500 bytes = ~3.6 MB/hour (higher than Waku due to JSON overhead)
- **Connection**: 2-3 WebSocket connections to relays. Keep-alive: ~20 KB/hour
- **Total**: ~4 MB/hour. Higher than Waku but still acceptable for a navigation session
- **Battery**: < 1% on modern devices. WebSocket connections are lightweight

---

### 9.4 Holepunch/Pears (Hyperswarm + Hypercore + Autobase) — Deep Analysis

#### Architecture for Traffic

The Holepunch stack offers a fundamentally different approach: **true peer-to-peer connections** via the Hyperswarm DHT with encrypted Noise streams, backed by Hypercore append-only logs.

**Proposed Architecture**:

1. **Peer discovery**: Each device joins a Hyperswarm topic per geohash region: `sha256("polaris-traffic-" + geohash4)`. The DHT facilitates NAT traversal and direct connection establishment.

2. **Direct probe exchange**: Once connected, peers exchange traffic probes directly over encrypted Noise streams using Protomux (protocol multiplexer). No relay intermediary.

3. **Aggregation via Autobase**: An Autobase instance per region collects probes from all connected writers. The `apply` function aggregates raw probes into per-segment speed summaries. The resulting `view` (a Hypercore) is the materialized traffic speed map.

4. **Sparse replication**: Devices only replicate the geohash regions they're interested in. Hypercore's sparse sync means they only download data they need.

**Mobile Integration**: The `react-native-bare-kit` package embeds the Bare runtime (a lightweight C-based JS runtime, not Node.js) into React Native. Communication between RN (Hermes) and Bare is via an IPC stream with RPC on top. This is the same approach used by Keet (Holepunch's messaging app) on iOS and Android.

```
React Native (Hermes) ←→ IPC/RPC ←→ Bare Worklet (Hyperswarm + Hypercore + Autobase)
```

#### Strengths

| Strength                                          | Detail                                                                                                                                                                                                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **True P2P — no relay/service nodes required**    | Hyperswarm uses a DHT for peer discovery and UDP hole-punching for direct connections. Once peers are connected, data flows directly between them. No servers in the middle                                                                      |
| **Noise-encrypted streams**                       | Every connection is end-to-end encrypted with the Noise protocol by default. No additional encryption layer needed. Relay operators (there are none) can't read probes                                                                           |
| **DHT-based peer discovery per geohash**          | Join a topic per geohash region. The DHT automatically handles peer discovery — connecting you to other devices interested in the same geographic area. Natural geographic clustering                                                            |
| **Autobase solves multi-writer aggregation**      | Autobase is purpose-built for exactly this use case: many writers (devices) contributing to a shared data structure (traffic speed map). Deterministic linearization means all peers converge on the same aggregated view                        |
| **Hypercore's sparse replication**                | Only download traffic data for regions you care about. Efficient incremental sync — only new entries are transferred                                                                                                                             |
| **react-native-bare-kit is production-tested**    | Used by Keet on iOS and Android. The Bare runtime is lighter than nodejs-mobile (~10 MB vs ~30-50 MB). It provides native UDP sockets (which Hermes lacks), critical for DHT operation                                                           |
| **Hyperswarm has suspend/resume**                 | `swarm.suspend()` and `swarm.resume()` are first-class APIs for mobile lifecycle management. When the app backgrounds, the swarm suspends cleanly. On resume, it reconnects and re-announces                                                     |
| **Eliminates the service node bootstrap problem** | The DHT itself is the bootstrap. The default Hyperswarm DHT has 3 public bootstrap nodes. Any Polaris desktop user running a full node becomes a persistent DHT node, strengthening the network                                                  |
| **Protobuf-native messages**                      | Probes are exchanged as raw protobuf over the wire. No JSON serialization overhead. 60-byte probes stay 60 bytes                                                                                                                                 |
| **Bandwidth: only exchange with direct peers**    | No gossip forwarding to uninvolved nodes. You only send/receive data from peers in your geohash area                                                                                                                                             |
| **Autobase quorum & signed length**               | Autobase provides checkpoint guarantees — once a majority of indexers sign off on a state, it's immutable. This prevents retroactive manipulation of historical traffic data                                                                     |
| **Mutable DHT records**                           | HyperDHT supports `mutablePut`/`mutableGet` — devices can publish their current speed as a mutable record keyed by their public key. Other devices can look up nearby peers' speeds directly from the DHT without establishing a full connection |

#### Weaknesses

| Weakness                                 | Detail                                                                                                                                                                                                                                                                                 |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **NAT traversal isn't 100%**             | UDP hole-punching works for most consumer NATs but fails behind symmetric NATs (carrier-grade NAT, some corporate networks). Fallback is relay through reachable peers, but this adds latency and is not guaranteed. Hyperswarm's success rate is ~85-90% based on Keet telemetry      |
| **Cold-start peer density**              | If only 2 drivers are on the road in a geohash4 area, they may connect but the traffic data is too sparse. Waku/Nostr service nodes can aggregate data from many regions; Hyperswarm peers only see peers in their topic                                                               |
| **Autobase complexity**                  | Autobase is the most complex piece. It requires indexer nodes to sign checkpoints. In a traffic system, who are the indexers? Options: (a) any peer with sufficient uptime, (b) desktop "full node" users, (c) dedicated community nodes. The indexer selection problem is non-trivial |
| **Autobase stability**                   | Autobase was marked `stable` in docs.pears.com as of 2026. However, the git history shows commits as recent as last month (v7.27.3) with fixes to recovery flows. The API surface is large and the reordering behavior is complex. Production use outside of Keet is limited           |
| **No built-in spam prevention**          | Like Nostr, Hyperswarm has no protocol-level rate limiting. The DHT `firewall` callback can reject connections from unknown pubkeys, but this requires a reputation/whitelist system                                                                                                   |
| **Bare runtime is a separate JS engine** | Communication between Hermes (RN) and Bare (worklet) crosses a process boundary via IPC/RPC. Serialization overhead for every probe that needs to reach the RN UI. However, traffic data flows Bare→RN only when the UI needs updated speed overlays, not per-probe                    |
| **react-native-bare-kit documentation**  | Docs exist (the Making a Bare Mobile App guide is solid) but third-party usage outside Holepunch's own apps is still limited. Community support is growing but thin                                                                                                                    |
| **DHT queries have latency**             | Initial peer discovery via DHT lookup takes 1-5 seconds. Subsequent connections are cached. This means the first traffic update after opening the app may be delayed. Hyperswarm's `findingPeers()` hook helps manage this                                                             |
| **Bandwidth for Autobase replication**   | Autobase replicates the full causal DAG between writers, not just the latest state. For a high-throughput traffic system (thousands of probes/minute in a metro area), the DAG could grow large. Need aggressive pruning/rolling window                                                |

#### Mobile Battery/Bandwidth Profile

- **Outbound**: 1 probe/5s × 60 bytes (raw protobuf) = 720 bytes/min = ~43 KB/hour
- **Inbound**: 10 peers × 12 probes/min × 60 bytes = ~430 KB/hour
- **DHT maintenance**: Periodic queries and keep-alive. ~100-200 KB/hour
- **Autobase sync**: Depends on DAG size. For a rolling 5-minute window with aggressive GC: ~200 KB/hour
- **Total**: ~800 KB - 1 MB/hour. Comparable to Waku, much less than Nostr
- **Battery**: UDP is more battery-efficient than TCP WebSockets. NAT traversal pings add some overhead. Estimated: < 1% per hour

---

### 9.5 Comparative Analysis

| Dimension                   | Waku v2                                                 | Nostr                                   | Holepunch/Pears                                       |
| --------------------------- | ------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------- |
| **Decentralization**        | Medium — requires service nodes (decentralized servers) | Low-Medium — requires relay servers     | **High** — true P2P via DHT + hole-punching           |
| **Latency**                 | 1-5s (gossip hops)                                      | 50-200ms (WebSocket to relay)           | **200ms-2s** (direct peer connection after discovery) |
| **Mobile runtime**          | nodejs-mobile (30-50 MB, V8 thread)                     | **Native WebSocket (0 overhead)**       | Bare worklet (10-15 MB, Bare thread)                  |
| **Bandwidth (mobile)**      | ~500 KB-1 MB/hr                                         | ~4 MB/hr (JSON overhead)                | **~800 KB-1 MB/hr**                                   |
| **Spam prevention**         | **RLN (built-in ZK-based)**                             | None (must build)                       | None (must build)                                     |
| **Aggregation**             | Application-level                                       | Application-level                       | **Autobase (built-in CRDT-like multi-writer)**        |
| **Geographic filtering**    | Content topics by geohash                               | `g` tag filtering on relays             | Swarm topics by geohash + direct peer exchange        |
| **Cold-start resilience**   | Medium — depends on service nodes                       | **High** — thousands of existing relays | Low — needs peers in your area                        |
| **Privacy**                 | Medium — service nodes see content topics               | Low — relays see full event content     | **High** — E2E encrypted, no intermediary             |
| **Complexity**              | High (libp2p + nodejs-mobile + bridge)                  | **Low** (WebSocket + JSON)              | High (Bare worklet + Hyperswarm + Autobase)           |
| **Production mobile proof** | Status Messenger                                        | Damus, Amethyst, Primal                 | Keet                                                  |
| **RN integration maturity** | DIY via nodejs-mobile                                   | **Trivial** (WebSocket)                 | Documented via react-native-bare-kit                  |
| **App size impact**         | +30-50 MB                                               | **+0 MB**                               | +10-15 MB                                             |
| **Protocol overhead**       | ~100 bytes/msg (protobuf + libp2p)                      | ~400-500 bytes/msg (JSON + sig)         | **~60 bytes/msg** (raw protobuf)                      |

---

### 9.6 Hybrid Architecture Recommendation

**No single protocol optimally serves all traffic system requirements.** The optimal architecture is a _hybrid_ that uses Holepunch/Pears as the primary P2P layer and Nostr as the fallback/bootstrap layer:

#### Tier 1: Holepunch/Pears (Primary — Peer-Rich Areas)

Use Hyperswarm + Autobase as the primary traffic data exchange when sufficient peers are available:

- **Probe publishing**: Device joins Hyperswarm topic `sha256("polaris-traffic-v1-" + geohash4)`. Directly exchanges probes with connected peers.
- **Aggregation**: An Autobase per geohash4 region. Mobile peers are writers; desktop "full node" users serve as indexers. The Autobase `apply` function computes per-segment average speeds from the probe stream.
- **Traffic speed map**: The Autobase view is a Hyperbee (B-tree on Hypercore) keyed by segment ID → current speed. Valhalla reads this on route computation.
- **Runtime**: `react-native-bare-kit` Worklet runs the entire P2P stack. Communication to RN via RPC for UI updates (traffic overlay colors, ETA updates).

**Why primary**: True P2P, lowest bandwidth, native aggregation, best privacy, no service infrastructure.

#### Tier 2: Nostr (Fallback — Sparse Areas + Cold Start)

When the Hyperswarm topic has < 3 connected peers (common in low-density areas or cold-start), fall back to Nostr:

- **Probe publishing**: Publish traffic probes as ephemeral Nostr events (kind 20100) with `g` tag (geohash) and `expiration` tag (5-minute TTL) to 2-3 Nostr relays.
- **Subscription**: Subscribe via `REQ` with `#g` filter to receive probes from the same geohash area from other users who are also in fallback mode.
- **Relay selection**: Use a mix of (a) dedicated Polaris community relays and (b) public relays that support geohash filtering.
- **Aggregation**: Client-side aggregation of received Nostr probes, same algorithm as the Autobase `apply` function but without multi-writer consensus.

**Why fallback**: Zero additional runtime overhead (pure WebSocket in Hermes), massive existing relay infrastructure handles the cold-start problem, works even when no nearby P2P peers exist.

#### Tier 3: Waku — Removed from Architecture

Waku is **not recommended** for the traffic system:

1. **nodejs-mobile is redundant** — react-native-bare-kit already provides a side runtime for P2P code. Running both nodejs-mobile (for Waku) and Bare (for Hyperswarm) would be absurd — two extra JS runtimes.
2. **Service node dependency** provides weaker decentralization than Hyperswarm's DHT.
3. **No aggregation primitive** — would need to build what Autobase provides out of the box.
4. **Organizational uncertainty** — js-waku's rename to logos-delivery-js and restructuring under IFT/Logos suggests shifting priorities.

The only Waku advantage (RLN spam prevention) can be replicated via:

- NIP-13 proof-of-work on Nostr events
- Hyperswarm `firewall` callback + reputation checking on Autobase peers
- Application-level probe validation (speed < 200 km/h, bearing consistent with road geometry, etc.)

---

### 9.7 Revised Stack for Traffic System

```
┌─────────────────────────────────────────────────────────────┐
│                    React Native (Hermes)                    │
│  ┌──────────────┐  ┌──────────────────┐  ┌──────────────┐  │
│  │ Traffic UI   │  │ Valhalla Bridge  │  │ Nostr Client │  │
│  │ (Map overlay)│  │ (JSI → C++)     │  │ (WebSocket)  │  │
│  └──────┬───────┘  └────────┬─────────┘  └──────┬───────┘  │
│         │ IPC/RPC           │                    │          │
├─────────┼───────────────────┼────────────────────┼──────────┤
│         ▼                   │                    │          │
│  ┌──────────────────────┐   │                    │          │
│  │  Bare Worklet         │   │                    │          │
│  │  (react-native-bare-kit) │                    │          │
│  │  ┌──────────────────┐ │   │                    │          │
│  │  │ Hyperswarm       │ │   │    ┌──────────────┼────┐     │
│  │  │ (topic/geohash4) │ │   │    │ Nostr Relays │    │     │
│  │  └────────┬─────────┘ │   │    │ (fallback)   │    │     │
│  │  ┌────────▼─────────┐ │   │    └──────────────┘    │     │
│  │  │ Autobase         │ │   │                         │     │
│  │  │ (probe → speed)  │◄├───┤   Traffic Speed Map     │     │
│  │  └────────┬─────────┘ │   │   (segment → speed)     │     │
│  │  ┌────────▼─────────┐ │   │                         │     │
│  │  │ Hyperbee View    │ │   │    Valhalla reads       │     │
│  │  │ (speed map)      │─├───┼──► traffic overrides    │     │
│  │  └──────────────────┘ │   │                         │     │
│  └──────────────────────┘   │                         │     │
└─────────────────────────────┼─────────────────────────┘     │
                              │                               │
                    ┌─────────▼───────────┐                   │
                    │ Valhalla (C++ native)│                   │
                    │ traffic.tar speed map│                   │
                    └─────────────────────┘                   │
```

**Mode selection logic** (runs in Bare worklet):

```
peerCount = swarm.connections.size for current geohash4 topic

if (peerCount >= 3) {
  mode = "hyperswarm"  // Primary: direct P2P exchange via Autobase
} else {
  mode = "nostr"       // Fallback: publish/subscribe via relays
}

// Both modes feed the same aggregation pipeline
// Autobase view OR client-side aggregation → Hyperbee speed map
```

---

### 9.8 Migration Path from Current Architecture

The current research (Topic 3) planned Waku v2 via nodejs-mobile. The revised recommendation:

| Component           | Was                     | Now                                       | Migration Effort                                                               |
| ------------------- | ----------------------- | ----------------------------------------- | ------------------------------------------------------------------------------ |
| P2P runtime         | nodejs-mobile (V8)      | react-native-bare-kit (Bare)              | **Medium** — already planned for Hypercore (Topic 5). Now also handles traffic |
| Traffic pub/sub     | Waku light push/filter  | Hyperswarm topics + direct exchange       | **Medium** — different API but simpler (no GossipSub)                          |
| Traffic aggregation | Application-level in RN | Autobase in Bare worklet                  | **Low** — Autobase handles the hard parts (ordering, consensus)                |
| Fallback messaging  | None (single-stack)     | Nostr ephemeral events                    | **Low** — WebSocket + JSON, trivial to implement                               |
| Spam prevention     | Waku RLN                | Application-level validation + NIP-13 PoW | **Low** — simpler, with tradeoffs acknowledged                                 |
| nodejs-mobile       | Required                | **Eliminated**                            | **Positive** — removes 30-50 MB and a full V8 runtime                          |

**Key benefit**: By using react-native-bare-kit for both Hypercore data sync (Topic 5) **and** traffic (this topic), we eliminate nodejs-mobile entirely from the app. One side runtime instead of two.

---

### 9.9 Risk Assessment

| Risk                           | Severity | Mitigation                                                                                                                                               |
| ------------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Autobase instability           | Medium   | Use single-writer Hypercore as fallback if Autobase misbehaves. Client-side aggregation works without consensus                                          |
| NAT traversal failures         | Medium   | Nostr fallback ensures traffic data flows even when hole-punching fails. Monitor success rates in telemetry                                              |
| Hyperswarm DHT bootstrap       | Low      | 3 public bootstrap nodes + any Polaris desktop user as a persistent node. DHT is self-healing                                                            |
| react-native-bare-kit maturity | Medium   | Keet ships with it on both platforms. The Autopass mobile example (docs.pears.com) demonstrates the exact integration pattern we need                    |
| Spam/fake probes               | Medium   | Validate: speed ∈ [0, 200] km/h, bearing consistent with road geometry (segment snap), probe timestamp within ±30s of current time, reputation weighting |
| High-density metro areas       | Low      | Hyperswarm handles 100+ connections well. Autobase's `bigBatches` mode handles high-throughput apply functions                                           |

---

### 9.10 Conclusion

**Holepunch/Pears is the better system for decentralized traffic flow tracking**, replacing Waku as the primary protocol. The key advantages are:

1. **True P2P** — no service node dependency, strongest decentralization guarantee
2. **Unified runtime** — react-native-bare-kit replaces nodejs-mobile for both traffic AND Hypercore data sync, saving 30-50 MB of app size
3. **Native aggregation** — Autobase provides built-in multi-writer consensus, solving the hardest problem in distributed traffic aggregation
4. **Best bandwidth efficiency** — raw protobuf over encrypted streams, no JSON or GossipSub overhead
5. **Best privacy** — E2E encrypted connections, no intermediary can observe traffic patterns
6. **Mobile-first design** — `swarm.suspend()`/`swarm.resume()`, Bare's small footprint, Keet proves it works

**Nostr serves as the essential fallback layer** for cold-start and sparse-peer scenarios, leveraging its zero-overhead WebSocket integration and massive existing relay network.

**Waku is removed from the traffic architecture** — it adds complexity without sufficient benefit over the Holepunch + Nostr hybrid.
