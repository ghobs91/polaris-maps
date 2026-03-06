# Research Report: React Native Decentralized Mapping Stack

> **Date:** 2026-03-05
> **Scope:** Research only — no code changes
> **Platform:** React Native (Expo bare workflow), iOS + Android

---

## Topic 1: PMTiles + MapLibre on React Native

### Decision

Use `@maplibre/maplibre-react-native` with a local HTTP server (e.g., [`react-native-static-server`](https://github.com/nickhudkins/react-native-static-server) or a lightweight embedded server) to serve PMTiles from the filesystem. For remote tiles, use Arweave gateway URLs with HTTP range requests directly via MapLibre's standard tile source configuration.

### Rationale

**`addProtocol` handler availability:**
MapLibre GL JS (web) exposes `addProtocol()` which the `pmtiles` JS library uses to intercept `pmtiles://` URLs and translate them into range requests. **MapLibre Native (iOS/Android) does not expose an equivalent `addProtocol` API.** The `@maplibre/maplibre-react-native` package wraps the native SDKs, so the JS-level protocol handler is unavailable. There is no built-in way to register a custom protocol handler in the native MapLibre rendering pipeline.

**Workarounds for local PMTiles:**

1. **Local HTTP server** — Run a lightweight HTTP server on-device (port 8080 or similar) that reads the local `.pmtiles` file and responds to range requests. MapLibre can then load tiles from `http://localhost:8080/{z}/{x}/{y}.mvt`. This is the most reliable approach and what projects like Organic Maps use conceptually for local data.
2. **Pre-extract to MBTiles / directory** — Convert PMTiles to MBTiles (SQLite-based) and use MapLibre's native MBTiles support or a file-based tile source. This avoids the range-request issue entirely but loses the single-file advantage of PMTiles.
3. **Custom native module** — Write a Turbo Module / native module that intercepts tile requests at the native layer. High development cost and fragile across MapLibre version updates.

**Remote loading from Arweave gateways:**
Arweave gateways (ar.io) do support HTTP range requests (`Range` header). PMTiles relies on range requests to read the directory and tile data. MapLibre can be pointed at a standard `{z}/{x}/{y}` tile URL scheme if a server-side PMTiles-to-tile-URL adapter exists. Alternatively, a thin JS or native layer can prefetch the PMTiles directory and construct tile URLs. Latency is higher than CDN-hosted tiles (~200-600ms per range request to Arweave gateways).

**Dynamic source switching:**
MapLibre React Native supports changing the `styleJSON` or `tileUrlTemplates` programmatically. To switch between remote (Arweave) and local (localhost server) sources, update the style's `sources` object. This triggers a re-render with the new tile source. No teardown/rebuild of the map is needed.

### Alternatives Considered

| Alternative                        | Pros                               | Cons                                                               |
| ---------------------------------- | ---------------------------------- | ------------------------------------------------------------------ |
| Mapbox GL Native (proprietary)     | Better tooling, commercial support | License cost, not open-source                                      |
| MBTiles directly                   | Native SQLite support in MapLibre  | No single-file HTTP range-request model; harder to host on Arweave |
| `react-native-maps` (Google/Apple) | Simpler setup                      | No vector tile / custom style support; no offline PMTiles path     |
| Tangram ES                         | Supports custom data sources       | Smaller community, less maintained than MapLibre                   |

---

## Topic 2: Valhalla as React Native Native Module

### Decision

Valhalla is technically feasible but carries **high integration cost and large binary size**. Recommend evaluating OSRM (lighter) or a WASM-based routing engine first. If Valhalla is chosen, compile via CMake as a static library linked into a Turbo Module, with routing graph tiles bundled per metro area.

### Rationale

**Compilation for mobile:**

- Valhalla is C++17 with dependencies on Boost, Protobuf, LZ4, Lua (for tag parsing), and zlib.
- **iOS arm64:** Compilable via CMake + Xcode toolchain. No existing React Native bridge exists. You would create an Objective-C++ Turbo Module wrapping the Valhalla C++ API (`valhalla::tyr::route()`). Cross-compilation is well-tested since Valhalla builds on macOS natively.
- **Android arm64-v8a / armeabi-v7a:** Compilable via CMake + Android NDK. JNI bridge needed, wrapped in a Turbo Module (Java/Kotlin side). `armeabi-v7a` (32-bit ARM) may hit memory constraints for large routing graphs. The Boost dependency makes the NDK build non-trivial but achievable.
- **No existing RN bridge.** The closest prior art is [valhalla-mobile](https://github.com/nickhudkins/valhalla-mobile) (prototype, not production) and various WASM compilations targeting browsers.

**Binary size:**
| Platform | Estimated Library Size |
|---|---|
| iOS arm64 (static lib, stripped) | ~15-25 MB |
| Android arm64-v8a (shared lib, stripped) | ~12-20 MB |
| Android armeabi-v7a | ~10-18 MB |

These are rough estimates including Boost and Protobuf statically linked. Stripping and LTO can reduce by ~20-30%. This adds significantly to app size — expect **+20-30 MB** to the final APK/IPA.

**Routing graph tile size:**
Valhalla uses its own tile format (`.gph` files organized in a directory hierarchy). Metro-area extracts (from OSM):
| Region | Approx. Tile Size |
|---|---|
| Los Angeles metro | ~150-250 MB |
| San Francisco Bay | ~80-120 MB |
| New York metro | ~200-300 MB |
| Small city (e.g., Portland) | ~30-60 MB |

These can be gzip-compressed (~40-50% reduction) and decompressed on-device. Tiles must be pre-built using `valhalla_build_tiles` offline and bundled or downloaded.

**On-device routing performance (mid-range phone, e.g., Pixel 6a / iPhone SE 3):**

- **Short route (5 km urban):** ~100-300 ms
- **Medium route (30 km suburban):** ~300-800 ms
- **Long route (100+ km highway):** ~1-3 seconds
- **Turn-by-turn recalculation:** ~50-200 ms (using time-distance matrix shortcuts)

Memory usage during routing: ~100-300 MB resident, which is significant on devices with 4 GB RAM. Consider loading only needed tile regions into memory.

### Alternatives Considered

| Alternative               | Pros                                                          | Cons                                                                                   |
| ------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| OSRM (C++)                | Faster queries, smaller binary (~8-12 MB)                     | Requires pre-processing into `.osrm` format; less flexible than Valhalla's multi-modal |
| GraphHopper (Java)        | Good Android fit                                              | JVM overhead; harder on iOS; large memory footprint                                    |
| BRouter (Java)            | Designed for offline/mobile, small tiles (~5 MB for a region) | Bicycle-focused; limited car routing                                                   |
| Mapbox Directions (API)   | No on-device cost                                             | Requires network; centralized; per-request pricing                                     |
| WASM Valhalla via WebView | Avoids native compilation                                     | Performance penalty; complex bridge; limited memory                                    |

---

## Topic 3: Waku v2 on React Native via nodejs-mobile

### Decision

Use `nodejs-mobile-react-native` running Waku's JS SDK (`@waku/sdk`) in light-push + filter mode. Implement geographic sharding via GossipSub topic naming with geohash prefixes (e.g., `/polaris/1/poi-9q5/proto`).

### Rationale

**nodejs-mobile threading model:**

- `nodejs-mobile-react-native` runs a **full Node.js instance in a dedicated background thread** (using the V8 engine on Android, JavaScriptCore or V8 on iOS).
- It is **completely separate from the React Native JS thread** (Hermes/JSC). Two JS runtimes run concurrently.
- The Node.js thread has access to native Node.js APIs (fs, net, crypto, etc.) which Waku's libp2p stack requires.
- Known limitations: startup time is ~1-2 seconds; memory overhead is ~30-50 MB for the Node.js runtime.
- Latest `nodejs-mobile` supports Node 18 LTS. Verify `@waku/sdk` dependency compatibility.

**RN ↔ nodejs-mobile communication:**

- Communication uses a **message-passing bridge** via `nodejs.channel.send()` (Node side) and `nodejs.channel.addListener()` (RN side).
- Messages are **serialized as strings** (JSON). No shared memory or direct object passing.
- Pattern: RN sends commands (subscribe, publish, query) as JSON → Node.js Waku process handles them → responses/events stream back as JSON messages.
- Latency per message: ~1-5 ms. Suitable for POI update events (not for high-frequency data).
- Recommended: Define a typed protocol (request ID, method, params, result/error) to avoid race conditions.

**Relay vs Light-push + Filter:**
| Mode | Battery | Bandwidth | Reliability |
|---|---|---|---|
| **Relay (full node)** | High — constantly relaying messages for others, maintains persistent connections | High — gossips all messages in subscribed topics to peers | Best — fully decentralized |
| **Light-push + Filter** | Low — only sends/receives own messages, connections are ephemeral | Low — only user's messages traverse the network | Depends on service nodes being available |

**Recommendation: Light-push + Filter for mobile.** Relay mode would drain battery rapidly and consume significant mobile data by relaying other users' messages. Light-push + filter offloads gossip to always-on service nodes while the mobile device only sends (light-push) and receives (filter) relevant messages.

Caveat: Light-push + filter requires **service nodes** (nwaku or go-waku nodes running relay + lightpush + filter protocols). For a decentralized app, you need a reliable set of service nodes. Consider running incentivized service nodes or partnering with the Waku fleet.

**Geographic sharding (GossipSub topics):**
Use geohash-prefixed content topics:

```
/polaris/1/poi-{geohash_prefix}/proto
```

- **Geohash precision 4** (~39 km × 20 km cells): Good for metro-area granularity. ~10-20 topics for a large metro.
- **Geohash precision 5** (~5 km × 5 km cells): Neighborhood-level. ~100-200 topics per metro.
- Subscribe to topics matching visible map viewport + 1-cell buffer.
- Dynamically subscribe/unsubscribe as the user pans the map.
- GossipSub mesh maintenance overhead is proportional to number of subscribed topics — keep it under ~20 concurrent topics.

### Alternatives Considered

| Alternative                         | Pros                                          | Cons                                                                     |
| ----------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------ |
| libp2p directly (via nodejs-mobile) | Full control, no Waku abstraction layer       | Much more code to write; must implement own pubsub, discovery, protocols |
| Waku React Native SDK (if released) | Native integration, no nodejs-mobile overhead | Does not exist yet as a production RN library (as of early 2026)         |
| Matrix protocol (decentralized)     | Mature SDKs, good RN support                  | Server-heavy architecture; not true P2P for pubsub                       |
| MQTT over Tor                       | Lightweight pubsub                            | Centralized broker; Tor adds latency                                     |
| XMTP                                | Good RN SDK                                   | Focused on messaging, not geo-sharded pubsub                             |

---

## Topic 4: Gun.js on React Native

### Decision

Gun.js is a viable option for CRDT-based POI data with important caveats: **Hermes compatibility requires polyfills**, DHT peer discovery effectively requires at least one relay/signaling server, and **MMKV is the recommended storage adapter** for performance on mobile.

### Rationale

**Hermes engine compatibility:**

- Gun.js uses `setTimeout`/`setInterval`, `TextEncoder`/`TextDecoder`, `WebSocket`, and `crypto.getRandomValues()` — some of which need polyfills on Hermes.
- **Key issues:**
  - `TextEncoder` / `TextDecoder`: Not available in Hermes. Polyfill with `text-encoding` or `fast-text-encoding`.
  - `crypto.getRandomValues()`: Not available. Polyfill with `react-native-get-random-values` (must import before Gun).
  - `WebSocket`: Available in RN globals — Gun can use this natively.
  - `localStorage`: Not available. Gun falls back to its RAD (Radix Storage Engine) which can use custom adapters.
- Gun.js does work on Hermes with proper polyfills, but **test thoroughly** — edge cases with `eval()` usage in Gun's SEA (Security, Encryption, Authorization) module can be problematic since Hermes doesn't support `eval()`. The SEA module may need patching or an alternative crypto approach.

**DHT peer discovery:**

- Gun uses **WebSocket relay peers** for discovery and message routing by default. It does **not** implement a true DHT like Kademlia.
- "Decentralized" in Gun's model means: any node can be a relay, data is replicated across connected peers via CRDT sync.
- **Without any relay server, peers cannot discover each other.** Gun has no built-in NAT traversal, mDNS, or DHT-based peer discovery.
- Options: (a) run your own Gun relay/super-peer nodes, (b) use Gun's community relays (unreliable), (c) implement WebRTC peer discovery via a signaling server.
- For truly decentralized discovery, Gun alone is insufficient — you'd need to layer on libp2p or a separate DHT.

**CRDT HAM conflict resolution:**

- Gun uses the **HAM (Hypothetical Amnesia Machine)** algorithm for conflict resolution. It's a state-based CRDT that uses vector clocks with machine state.
- For concurrent POI edits: **last-write-wins per property**, with HAM's conflict function determining which write takes precedence based on state (timestamp + deterministic tiebreaker).
- **Granularity:** Conflicts are resolved at the **property level**, not the document level. If User A edits `poi.name` and User B edits `poi.rating` concurrently, both writes are preserved. If both edit `poi.name`, HAM picks one deterministically.
- Limitation: HAM does not support **operational transforms** or **sequence CRDTs** — no collaborative text editing or ordered list merging on a single field.
- For POI data (name, coordinates, tags, ratings), property-level LWW is generally adequate.

**Storage adapter options:**
| Adapter | Read/Write Speed | Max Size | Notes |
|---|---|---|---|
| `AsyncStorage` | Slow (JSON serialization, async bridge) | ~6 MB on Android default | Default RN storage; too slow for Gun's frequent writes |
| `SQLite` (via `expo-sqlite` or `react-native-sqlite-storage`) | Medium | Unlimited | Good for large datasets; adapter exists (`gun-sqlite`) but may need updates |
| **`MMKV`** (via `react-native-mmkv`) | Very fast (synchronous, memory-mapped) | Practical ~256 MB | **Best fit.** A `gun-mmkv` adapter can be written in ~50 lines. Synchronous access matches Gun's internal sync patterns. |
| `Realm` | Fast | Unlimited | Overkill; complex setup for a key-value CRDT store |

**Recommendation: MMKV.** Its synchronous API and memory-mapped I/O align well with Gun's high-frequency read/write pattern. Write a thin adapter implementing Gun's `get`/`put` interface.

### Alternatives Considered

| Alternative         | Pros                                                         | Cons                                                        |
| ------------------- | ------------------------------------------------------------ | ----------------------------------------------------------- |
| Automerge           | True CRDT library, rich data types, good RN support via WASM | No built-in networking; must pair with a sync layer         |
| Yjs                 | Excellent CRDT, good ecosystem                               | Focused on collaborative editing; no built-in P2P discovery |
| OrbitDB (over IPFS) | CRDT + content-addressed storage                             | Heavy dependency (IPFS); poor RN support                    |
| PouchDB/CouchDB     | Mature sync protocol                                         | Requires CouchDB server; not truly P2P                      |

---

## Topic 5: Hypercore / react-native-bare-kit

### Decision

Hypercore via `react-native-bare-kit` is **promising but not yet production-ready** for a critical-path feature. Autobase (multi-writer) is still stabilizing. Recommend as a **secondary/experimental** sync layer, not the primary data store, unless development timeline allows for instability.

### Rationale

**Production readiness and platform support:**

- `react-native-bare-kit` embeds [Bare](https://bare.js.org/) (a lightweight JS runtime by the Holepunch team) as a native module in RN.
- **Bare** is a minimal JS runtime (like Node.js but stripped down) designed for embedding. It supports libuv, native addons (via bare-addon), and the Holepunch stack (hypercore, hyperdrive, hyperbee, hyperswarm).
- **Platform support:** iOS arm64 and Android arm64-v8a are supported. armeabi-v7a (32-bit) support is less tested.
- **Production readiness (as of early 2026):** `react-native-bare-kit` is still in **active development with breaking changes**. The Keet messaging app (by Holepunch) uses it in production, which is a strong signal, but Keet is a single product with tight coupling to the Holepunch stack. Third-party adoption is limited.
- API surface may change. Documentation is sparse. Community support is small.

**Autobase (multi-writer) stability:**

- Autobase enables multiple writers on a single Hypercore-based data structure by linearizing multiple input cores into one output core.
- As of early 2026, Autobase has undergone **multiple API rewrites**. The current version (Autobase 2) is more stable than the original but still has known issues:
  - Merge conflicts during rapid concurrent writes can cause linearization lag.
  - Writer addition/removal mid-session can cause temporary inconsistencies.
  - The "boot record" mechanism for persisting multi-writer state is functional but under-documented.
- **Verdict:** Usable for moderate write concurrency (a few concurrent editors). Not battle-tested for high-write-throughput scenarios with many concurrent writers.

**DHT peer discovery on mobile (NAT traversal):**

- Hyperswarm (the networking layer) uses a **custom DHT** (based on Kademlia) with built-in **UDP hole punching** for NAT traversal.
- On mobile: **UDP hole punching works on most carrier NATs** but not all (symmetric NATs are problematic). Hyperswarm includes relay fallback for cases where hole punching fails.
- Mobile-specific issues:
  - Background execution: iOS aggressively kills background network connections. Hyperswarm connections will drop when the app is backgrounded. Need to handle reconnection gracefully.
  - Battery: Maintaining DHT presence requires periodic keep-alive packets. Light DHT mode (bootstrap + lookup only, no routing table maintenance) reduces this.
  - IPv6: Some carriers use IPv6-only. Hyperswarm's DHT is primarily IPv4. May need dual-stack handling.

**Sync performance for large dataset deltas:**

- Hypercore sync is **append-only log replication** — very efficient for sequential data (only new entries are transferred).
- For a Hyperbee (B-tree on Hypercore) with 100K POI entries:
  - **Initial full sync:** ~5-15 seconds on LTE (depending on entry size, ~10-50 MB).
  - **Incremental delta sync (100 new entries):** ~100-500 ms.
  - **Seek to specific key:** O(log n) with Hyperbee, ~10-50 ms.
- Hypercore uses **Merkle tree verification** — integrity is verified during sync without trusting the peer.
- Bottleneck is usually network, not CPU. On-device Hypercore operations are fast (~1 ms per append).

### Alternatives Considered

| Alternative          | Pros                               | Cons                                                    |
| -------------------- | ---------------------------------- | ------------------------------------------------------- |
| Gun.js               | Simpler API, works in RN directly  | No structured replication protocol; relay-dependent     |
| IPFS (Helia)         | Content-addressed, large ecosystem | Heavy; poor mobile performance; no efficient delta sync |
| libp2p + custom sync | Full control over protocol         | Massive development effort                              |
| Earthstar            | Designed for small-group sync      | Small community; limited tooling                        |

---

## Topic 6: On-Device Geocoding (Pelias Extracts in SQLite FTS5)

### Decision

Use pre-processed Pelias data extracts loaded into SQLite with FTS5 for forward geocoding and R-tree for reverse geocoding. Metro-area extracts are ~50-200 MB. FTS5 query latency is **<50 ms** on mid-range devices.

### Rationale

**Pelias extract structure and SQLite FTS5 loading:**

- Pelias uses Elasticsearch as its data store, with data sourced from OpenStreetMap, OpenAddresses, Who's Who on First (WOF), and GeoNames.
- **Extract process:** Run Pelias importers to populate Elasticsearch, then **export to CSV/JSON** using a custom script (no built-in SQLite export). Each record contains: `name`, `housenumber`, `street`, `locality`, `region`, `country`, `lat`, `lon`, `layer` (venue, address, street, etc.), `source`.
- **SQLite FTS5 schema:**
  ```sql
  CREATE VIRTUAL TABLE geocode_fts USING fts5(
    name, street, locality, region,
    content='places', content_rowid='id'
  );
  CREATE TABLE places (
    id INTEGER PRIMARY KEY,
    name TEXT, housenumber TEXT, street TEXT,
    locality TEXT, region TEXT, country TEXT,
    lat REAL, lon REAL, layer TEXT
  );
  ```
- FTS5 tokenizer: Use `unicode61` for accent-insensitive matching. Consider `trigram` tokenizer for fuzzy/substring matching (slightly larger index).
- Build the SQLite database **server-side** during the data pipeline, then distribute the `.db` file to devices as a downloadable asset.

**Metro-area extract size:**
| Region | Approx. SQLite DB Size | Record Count |
|---|---|---|
| Los Angeles metro | ~100-200 MB | ~2-4 million records |
| San Francisco Bay | ~60-120 MB | ~1-2 million records |
| New York metro | ~150-250 MB | ~3-5 million records |
| Small city (Portland) | ~20-50 MB | ~500K-1 million records |

Sizes include FTS5 index and R-tree index. Compression (gzip) for download reduces by ~60-70%.

**FTS5 query latency on mobile:**

- **Forward geocoding query** (`MATCH 'coffee shop san francisco'`): **5-30 ms** on mid-range device (Pixel 6a, iPhone SE 3).
- **Prefix query** (`MATCH 'coff*'`): **10-50 ms** — slightly slower due to prefix expansion.
- **Ranked results** (using `bm25()`): Add ~5-10 ms overhead.
- SQLite FTS5 is **highly optimized** for mobile — it's the same engine used by Apple's Spotlight search and Android's system search.
- Key optimization: Use `ORDER BY rank LIMIT 10` to avoid scanning all matches.

**Reverse geocoding via R-tree spatial index:**

```sql
CREATE VIRTUAL TABLE places_rtree USING rtree(
  id, min_lon, max_lon, min_lat, max_lat
);
```

- R-tree nearest-neighbor query (find POI closest to a coordinate):
  ```sql
  SELECT p.* FROM places p
  JOIN places_rtree r ON p.id = r.id
  WHERE r.min_lon >= ? AND r.max_lon <= ?
    AND r.min_lat >= ? AND r.max_lat <= ?
  ORDER BY (p.lat - ?) * (p.lat - ?) + (p.lon - ?) * (p.lon - ?)
  LIMIT 1;
  ```
- Use a bounding box (±0.01° ≈ ±1 km) to limit the search area, then sort by distance.
- **Reverse geocoding latency:** **1-10 ms** for a bounded query. Extremely fast.
- For true nearest-neighbor without a bounding box, SQLite R-tree doesn't support native KNN, but the bounding-box approach with iterative widening is practical and fast.

### Alternatives Considered

| Alternative                    | Pros                              | Cons                                        |
| ------------------------------ | --------------------------------- | ------------------------------------------- |
| Nominatim (offline)            | Full OSM data model               | Requires PostgreSQL; not embeddable         |
| Photon (offline)               | Elasticsearch-based, good ranking | Requires JVM; not embeddable on mobile      |
| geocoder-geojson (client-side) | Simple GeoJSON search             | No FTS; slow for large datasets             |
| Custom trie/prefix index       | Minimal dependencies              | Must build from scratch; no ranking         |
| Apple/Google geocoding APIs    | High quality                      | Requires network; centralized; rate-limited |

---

## Topic 7: Nostr Keypair Identity on React Native

### Decision

Use `@noble/secp256k1` (or `@noble/curves`) for key generation and signing, store private keys in platform Secure Enclave (iOS Keychain / Android Keystore) via `react-native-keychain` or `expo-secure-store`, and implement NIP-01 event signing in JS.

### Rationale

**Best secp256k1 library for RN:**
| Library | Hermes Compatible | Bundle Size | Performance | Notes |
|---|---|---|---|---|
| **`@noble/secp256k1`** (or `@noble/curves`) | Yes | ~20 KB | Good (~5-15 ms sign on mid-range) | **Recommended.** Pure JS, no native deps. Audited. Works on Hermes without polyfills (needs `crypto.getRandomValues` polyfill). |
| `react-native-secp256k1` | Yes | ~50 KB (+ native) | Fast (~1-5 ms sign) | Native C binding. Faster but adds native build complexity. Less maintained. |
| `secp256k1-js` (elliptic) | Partial | ~100 KB | Slow (~20-50 ms) | Legacy; `elliptic` is heavy and has had vulnerability reports. |
| `bitcoin-secp256k1` (WASM) | No | ~200 KB | Fastest | WASM not well supported on Hermes. |

**Recommendation: `@noble/curves`** (successor to `@noble/secp256k1`). It is pure JavaScript, audited by Cure53, zero dependencies, and works reliably on Hermes with one polyfill (`react-native-get-random-values`).

**Secure Enclave storage:**

- **iOS Keychain:** Use `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` for keys that should never leave the device. The Secure Enclave can generate secp256k1-incompatible keys (it supports P-256 only), so store the **private key bytes** in the Keychain rather than using Secure Enclave key generation.
- **Android Keystore:** Similarly, Android Keystore's hardware-backed keys support ECDSA with P-256/P-384, **not secp256k1**. Store the private key bytes encrypted by a Keystore-backed AES key.
- **Libraries:**
  - `react-native-keychain`: Mature, well-maintained. Supports biometric access control. Can store arbitrary strings/bytes in Keychain/Keystore.
  - `expo-secure-store`: Simpler API, works in Expo bare workflow. 2048-byte value limit (sufficient for a 32-byte private key as hex/base64).
- **Recommendation:** `expo-secure-store` for simplicity in Expo bare workflow. If biometric unlock for signing is needed, use `react-native-keychain` with `accessControl: ACCESS_CONTROL.BIOMETRY_CURRENT_SET`.

**NIP-01 event signing implementation:**
NIP-01 defines the basic Nostr event structure:

```typescript
import { schnorr } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

interface NostrEvent {
  pubkey: string; // 32-byte hex (x-only pubkey)
  created_at: number; // unix timestamp
  kind: number; // event kind
  tags: string[][];
  content: string;
  id: string; // sha256 of serialized event
  sig: string; // schnorr signature
}

function signEvent(event: Omit<NostrEvent, 'id' | 'sig'>, privkey: Uint8Array): NostrEvent {
  const serialized = JSON.stringify([
    0,
    event.pubkey,
    event.created_at,
    event.kind,
    event.tags,
    event.content,
  ]);
  const id = bytesToHex(sha256(new TextEncoder().encode(serialized)));
  const sig = bytesToHex(schnorr.sign(id, privkey));
  return { ...event, id, sig };
}
```

- Nostr uses **Schnorr signatures** (BIP-340) over secp256k1, not ECDSA. `@noble/curves` supports this natively via `schnorr.sign()`.
- Public keys are **x-only** (32 bytes), not compressed (33 bytes).
- Event ID is `sha256(JSON.stringify([0, pubkey, created_at, kind, tags, content]))`.
- **Polyfill needed:** `TextEncoder` (via `fast-text-encoding`) on Hermes.

### Alternatives Considered

| Alternative                             | Pros                                  | Cons                                                                        |
| --------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------- |
| Generate keys in Secure Enclave (P-256) | Hardware-backed key never leaves chip | Incompatible with secp256k1/Schnorr; would need a different identity scheme |
| NIP-07 browser extension model          | Separates signing from app            | Not applicable to native RN                                                 |
| Ethereum wallet identity (ethers.js)    | Ecosystem of wallets                  | Different curve usage (ECDSA not Schnorr); heavier library                  |

---

## Topic 8: Arweave as Permanent Storage

### Decision

Use Arweave for permanent tile archive and POI dataset storage. Read via ar.io gateways with HTTP range request support (suitable for PMTiles). Upload costs are ~$0.50-2.00 per 100 MB (fluctuates with AR token price). Use Arweave manifests for versioned data bundles.

### Rationale

**Gateway read access (ar.io) and latency:**

- **ar.io** is the decentralized gateway network for Arweave. Gateways resolve transaction IDs to data.
- Access pattern: `https://{gateway}/raw/{transaction_id}` or via ArNS names: `https://{name}.arweave.net/`.
- **Latency:**
  - First request (cache miss): **200-800 ms** — gateway fetches from Arweave network miners.
  - Subsequent requests (cached): **50-150 ms** — comparable to standard CDN.
  - ar.io gateways cache popular content. PMTiles accessed frequently will be fast after initial fetch.
- **Reliability:** ar.io gateways are independent operators. Use multiple gateways with fallback: try `arweave.net`, then `ar-io.dev`, then others.
- **Rate limits:** Most gateways don't rate-limit reads aggressively, but heavy range-request patterns (PMTiles) may need a dedicated gateway or caching layer.

**HTTP range request support for PMTiles:**

- Arweave gateways **do support HTTP `Range` headers** on the `/raw/` endpoint. This is critical for PMTiles, which reads the directory (first ~16 KB) and then fetches individual tiles via byte-range requests.
- Verified behavior: `Range: bytes=0-16383` returns a `206 Partial Content` response.
- **Caveat:** Some gateways may return the full file instead of honoring range requests (non-compliant). Test specific gateways. `arweave.net` and major ar.io gateways support it.
- For production: Consider a **caching proxy** (Cloudflare Worker or similar) in front of the gateway to ensure consistent range request behavior and reduce redundant fetches.

**Upload cost model:**

- Arweave uses a one-time upload fee for **permanent storage** (200+ years replicated).
- Cost is denominated in AR tokens and fluctuates with token price and network demand.
- **Approximate costs (as of early 2026, subject to AR price):**
  | Data Size | Approx. Cost |
  |---|---|
  | 1 MB | ~$0.005-0.02 |
  | 100 MB | ~$0.50-2.00 |
  | 1 GB | ~$5-20 |
- Using **Bundlr/Irys** (bundled transactions): Can be cheaper and faster than direct L1 uploads. Irys provides instant finality and lazy uploading to Arweave L1.
- PMTiles for a metro area (~50-200 MB) would cost **~$0.25-4.00** for permanent storage — very economical.
- POI updates (small JSON, <1 KB each) cost fractions of a cent per transaction.

**Immutable data versioning strategy:**
Since Arweave data is immutable (each upload creates a new transaction ID), versioning requires a pointer mechanism:

1. **ArNS (Arweave Name System):**
   - Register a name (e.g., `polaris-la-tiles`) that points to a transaction ID.
   - Update the name to point to the latest version: `polaris-la-tiles.arweave.net` → `tx_id_v2`.
   - Cost: ArNS name registration requires staking/renting AR tokens. Annual cost varies.
   - **Best for:** Named datasets that update periodically (tile archives, curated POI exports).

2. **Arweave Manifests (Path Manifests):**
   - A JSON document listing paths → transaction IDs, uploaded as a single transaction.
   - Example: `{ "paths": { "tiles/la.pmtiles": { "id": "tx_abc" }, "poi/la.json": { "id": "tx_def" } } }`
   - Accessed via: `https://arweave.net/{manifest_tx_id}/tiles/la.pmtiles`
   - To update: create a new manifest pointing some paths to new transactions, others to old ones.
   - **Best for:** Bundling related assets with human-readable paths.

3. **GraphQL tag-based versioning:**
   - Tag uploads with metadata: `{ "App-Name": "Polaris", "Region": "LA", "Version": "2", "Type": "pmtiles" }`.
   - Query latest version via Arweave GraphQL: `transactions(tags: [{ name: "Region", values: ["LA"] }], sort: HEIGHT_DESC, first: 1)`.
   - **Best for:** Machine-readable version lookups without a name registry.

**Recommended approach:** Combine manifests (for bundling) + GraphQL tags (for discovery) + ArNS (for stable user-facing URLs).

### Alternatives Considered

| Alternative      | Pros                                         | Cons                                                                      |
| ---------------- | -------------------------------------------- | ------------------------------------------------------------------------- |
| IPFS + Filecoin  | Large ecosystem, pinning services            | Not permanent by default; pinning costs recur; gateway reliability varies |
| Ceramic Network  | Mutable streams on IPFS                      | Depends on IPFS; more complex; less suitable for large binary blobs       |
| Storj / Sia      | Decentralized storage with S3-compatible API | Not permanent; ongoing costs; less web3-native                            |
| BitTorrent + DHT | Zero storage cost                            | No persistence guarantee; requires seeders                                |
| Self-hosted S3   | Full control, low latency                    | Centralized; operational burden                                           |

---

## Summary Matrix

| Component         | Recommended Choice                                           | Maturity    | Risk Level  |
| ----------------- | ------------------------------------------------------------ | ----------- | ----------- |
| Map rendering     | MapLibre React Native + local HTTP server for PMTiles        | High        | Low         |
| Routing           | Valhalla native module (or OSRM if size constrained)         | Medium      | Medium-High |
| P2P messaging     | Waku v2 via nodejs-mobile (light-push + filter)              | Medium      | Medium      |
| Local database    | Gun.js with MMKV adapter (or Hypercore for append-only sync) | Medium      | Medium      |
| Append-only sync  | Hypercore via react-native-bare-kit                          | Low-Medium  | High        |
| Geocoding         | Pelias extracts in SQLite FTS5 + R-tree                      | High        | Low         |
| Identity          | Nostr keypair (@noble/curves + expo-secure-store)            | High        | Low         |
| Permanent storage | Arweave via ar.io gateways + Irys bundler                    | Medium-High | Low-Medium  |
