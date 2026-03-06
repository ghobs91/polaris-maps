# Data Model: Decentralized P2P Mapping Platform (Polaris Maps)

**Phase**: 1 — Design  
**Feature**: `001-p2p-depin-mapping`  
**Date**: 2026-03-05  
**Input**: spec.md (Key Entities), research.md (storage decisions)

---

## Storage Layer Overview

| Store                       | Technology               | Purpose                                                                    | Persistence              |
| --------------------------- | ------------------------ | -------------------------------------------------------------------------- | ------------------------ |
| Structured data             | SQLite (expo-sqlite)     | Routing graphs, geocoding indexes, tile metadata, POI cache, route history | On-device, permanent     |
| Key-value                   | MMKV (react-native-mmkv) | User preferences, map viewport, recent searches, Gun.js storage adapter    | On-device, permanent     |
| In-memory state             | Zustand                  | UI state, navigation state, active traffic overlays, peer status           | In-memory, ephemeral     |
| Decentralized mutable graph | Gun.js                   | POI contributions, reviews, ratings, reputation scores                     | Distributed across peers |
| Append-only sync            | Hypercore (bare-kit)     | Routing graph deltas, region manifests, POI edit logs                      | Peer-replicated feeds    |
| Permanent immutable         | Arweave                  | Base PMTiles, routing graphs, geocoding databases                          | Permanent, decentralized |

---

## Entity Definitions

### 1. MapTile

Represents a single vector map tile at a specific zoom level and coordinate.

**Storage**: SQLite (metadata + cache tracking), file system (actual tile data)

| Field           | Type             | Description                                      |
| --------------- | ---------------- | ------------------------------------------------ |
| `id`            | TEXT PK          | `{source}/{z}/{x}/{y}` composite key             |
| `source_id`     | TEXT NOT NULL    | Reference to the PMTiles archive (Arweave tx ID) |
| `z`             | INTEGER NOT NULL | Zoom level (0-14)                                |
| `x`             | INTEGER NOT NULL | Tile column                                      |
| `y`             | INTEGER NOT NULL | Tile row                                         |
| `byte_offset`   | INTEGER NOT NULL | Offset within the PMTiles file                   |
| `byte_length`   | INTEGER NOT NULL | Size in bytes                                    |
| `cached_at`     | INTEGER NOT NULL | Unix timestamp when tile was cached locally      |
| `last_accessed` | INTEGER NOT NULL | Unix timestamp of last access (for LRU eviction) |
| `file_path`     | TEXT             | Local file path if extracted/cached individually |

**Indexes**: `(z, x, y)`, `(source_id)`, `(last_accessed)` for LRU eviction

---

### 2. Region

Represents a downloadable geographic region with associated data bundles.

**Storage**: SQLite

| Field                  | Type          | Description                                       |
| ---------------------- | ------------- | ------------------------------------------------- |
| `id`                   | TEXT PK       | Region identifier (e.g., `us-ca-la`)              |
| `name`                 | TEXT NOT NULL | Human-readable name (e.g., "Los Angeles, CA")     |
| `bounds_min_lat`       | REAL NOT NULL | Bounding box south                                |
| `bounds_max_lat`       | REAL NOT NULL | Bounding box north                                |
| `bounds_min_lng`       | REAL NOT NULL | Bounding box west                                 |
| `bounds_max_lng`       | REAL NOT NULL | Bounding box east                                 |
| `pmtiles_tx_id`        | TEXT          | Arweave tx ID for the PMTiles archive             |
| `routing_graph_tx_id`  | TEXT          | Arweave tx ID for the Valhalla graph bundle       |
| `geocoding_db_tx_id`   | TEXT          | Arweave tx ID for the Pelias SQLite extract       |
| `version`              | TEXT NOT NULL | Dataset version (e.g., `2026-03`)                 |
| `download_status`      | TEXT NOT NULL | `none` \| `downloading` \| `complete` \| `failed` |
| `tiles_size_bytes`     | INTEGER       | Size of PMTiles archive                           |
| `routing_size_bytes`   | INTEGER       | Size of routing graph bundle                      |
| `geocoding_size_bytes` | INTEGER       | Size of geocoding database                        |
| `downloaded_at`        | INTEGER       | Unix timestamp of completed download              |
| `last_updated`         | INTEGER       | Unix timestamp of last data update                |

**Indexes**: Spatial index (R-tree) on bounding box for "which region contains this point?" queries

---

### 3. RoadSegment

Represents a section of road used for routing. Stored within Valhalla's native graph tile format on disk; a lightweight SQLite index enables traffic overlay mapping.

**Storage**: Valhalla graph tiles (file system), SQLite (segment-to-geohash index for traffic overlay)

| Field             | Type             | Description                                                                                   |
| ----------------- | ---------------- | --------------------------------------------------------------------------------------------- |
| `segment_id`      | TEXT PK          | Unique road segment identifier (Valhalla edge ID)                                             |
| `geohash6`        | TEXT NOT NULL    | 6-char geohash of segment midpoint (for traffic topic matching)                               |
| `way_id`          | TEXT             | OSM/Overture way ID for cross-referencing                                                     |
| `road_class`      | TEXT NOT NULL    | `motorway` \| `trunk` \| `primary` \| `secondary` \| `tertiary` \| `residential` \| `service` |
| `speed_limit_kmh` | INTEGER          | Posted speed limit                                                                            |
| `is_oneway`       | INTEGER NOT NULL | 0 = bidirectional, 1 = one-way                                                                |
| `start_lat`       | REAL NOT NULL    | Start point latitude                                                                          |
| `start_lng`       | REAL NOT NULL    | Start point longitude                                                                         |
| `end_lat`         | REAL NOT NULL    | End point latitude                                                                            |
| `end_lng`         | REAL NOT NULL    | End point longitude                                                                           |
| `region_id`       | TEXT NOT NULL FK | Region this segment belongs to                                                                |

**Indexes**: `(geohash6)` for traffic overlay lookup, `(region_id)`, R-tree on `(start_lat, start_lng, end_lat, end_lng)`

---

### 4. TrafficObservation

An anonymized speed report from a contributing device, published and consumed via Waku v2.

**Storage**: In-memory (Zustand) for active aggregation, SQLite for offline queue

#### Waku Message Schema (Protobuf)

| Field        | Type   | Description                                                   |
| ------------ | ------ | ------------------------------------------------------------- |
| `geohash6`   | string | 6-char geohash of observation point                           |
| `segment_id` | string | Road segment ID this observation maps to                      |
| `speed_kmh`  | float  | Observed speed in km/h                                        |
| `bearing`    | uint32 | Heading in degrees (0-359)                                    |
| `timestamp`  | uint64 | Unix timestamp (seconds)                                      |
| `probe_id`   | bytes  | Ephemeral session ID (rotated hourly, not linked to identity) |

**Content topic**: `/polaris/1/traffic/{geohash6}/proto`
**Message size**: ~40-60 bytes

#### Aggregated Traffic State (Zustand in-memory)

| Field              | Type         | Description                                       |
| ------------------ | ------------ | ------------------------------------------------- |
| `segment_id`       | string (key) | Road segment                                      |
| `avg_speed_kmh`    | number       | Rolling average speed from recent probes          |
| `sample_count`     | number       | Number of contributing probes in window           |
| `congestion_level` | enum         | `free_flow` \| `slow` \| `congested` \| `stopped` |
| `last_updated`     | number       | Timestamp of most recent probe                    |

---

### 5. Place (Business/POI Listing)

A point of interest stored in Gun.js for decentralized mutable access and cached in SQLite for fast local querying.

**Storage**: Gun.js (authoritative distributed), SQLite (local query cache)

#### Gun.js Graph Path: `poi/{geohash8}/{uuid}`

| Field              | Type             | Description                                              |
| ------------------ | ---------------- | -------------------------------------------------------- |
| `uuid`             | TEXT PK          | Unique identifier (UUIDv4)                               |
| `name`             | TEXT NOT NULL    | Business/place name                                      |
| `category`         | TEXT NOT NULL    | Category (e.g., `restaurant`, `pharmacy`, `park`)        |
| `lat`              | REAL NOT NULL    | Latitude                                                 |
| `lng`              | REAL NOT NULL    | Longitude                                                |
| `geohash8`         | TEXT NOT NULL    | 8-char geohash for geographic bucketing                  |
| `address_street`   | TEXT             | Street address                                           |
| `address_city`     | TEXT             | City                                                     |
| `address_state`    | TEXT             | State/province                                           |
| `address_postcode` | TEXT             | Postal code                                              |
| `address_country`  | TEXT             | Country code (ISO 3166-1 alpha-2)                        |
| `phone`            | TEXT             | Phone number                                             |
| `website`          | TEXT             | Website URL                                              |
| `hours`            | TEXT             | Operating hours (JSON-encoded structured format)         |
| `avg_rating`       | REAL             | Computed average rating (1.0-5.0)                        |
| `review_count`     | INTEGER          | Number of reviews                                        |
| `status`           | TEXT NOT NULL    | `open` \| `closed_temporarily` \| `closed_permanently`   |
| `source`           | TEXT NOT NULL    | `overture` (base data) \| `community` (user-contributed) |
| `author_pubkey`    | TEXT             | Nostr pubkey of creator (for community-sourced)          |
| `signature`        | TEXT             | Nostr Schnorr signature of the record                    |
| `created_at`       | INTEGER NOT NULL | Unix timestamp                                           |
| `updated_at`       | INTEGER NOT NULL | Unix timestamp                                           |

**SQLite indexes**: `(geohash8)`, FTS5 on `(name, category, address_street, address_city)`, `(category, geohash8)`, `(author_pubkey)`

---

### 6. Review

A user review for a Place, signed with the author's Nostr key.

**Storage**: Gun.js (authoritative), SQLite (local cache)

#### Gun.js Graph Path: `review/{poi_uuid}/{author_pubkey}`

| Field           | Type             | Description                                |
| --------------- | ---------------- | ------------------------------------------ |
| `id`            | TEXT PK          | `{poi_uuid}:{author_pubkey}` composite key |
| `poi_uuid`      | TEXT NOT NULL FK | Place being reviewed                       |
| `author_pubkey` | TEXT NOT NULL    | Nostr pubkey of reviewer                   |
| `rating`        | INTEGER NOT NULL | 1-5 star rating                            |
| `text`          | TEXT             | Review text (max 2000 chars)               |
| `signature`     | TEXT NOT NULL    | Nostr Schnorr signature                    |
| `created_at`    | INTEGER NOT NULL | Unix timestamp                             |
| `updated_at`    | INTEGER NOT NULL | Unix timestamp                             |

**Constraint**: One review per author per place (upsert on `poi_uuid + author_pubkey`)

---

### 7. PeerNode

Metadata about this device's participation in the peer network.

**Storage**: SQLite (local node state), Zustand (live connection state)

| Field                           | Type             | Description                                 |
| ------------------------------- | ---------------- | ------------------------------------------- |
| `pubkey`                        | TEXT PK          | This device's Nostr pubkey                  |
| `region_ids`                    | TEXT NOT NULL    | JSON array of cached region IDs             |
| `cache_size_bytes`              | INTEGER NOT NULL | Total local cache size                      |
| `data_served_bytes`             | INTEGER NOT NULL | Cumulative data served to peers             |
| `peer_connections`              | INTEGER NOT NULL | Current active peer count (live in Zustand) |
| `uptime_seconds`                | INTEGER NOT NULL | Cumulative uptime                           |
| `first_seen`                    | INTEGER NOT NULL | Unix timestamp of first network join        |
| `last_active`                   | INTEGER NOT NULL | Unix timestamp of last activity             |
| `resource_limit_storage_mb`     | INTEGER NOT NULL | Max storage budget                          |
| `resource_limit_bandwidth_mbps` | REAL NOT NULL    | Max bandwidth budget                        |
| `resource_limit_battery_pct_hr` | REAL NOT NULL    | Max battery % per hour                      |

---

### 8. UserReputation

Trust score for a peer, accumulated in Gun.js based on contribution history.

**Storage**: Gun.js (authoritative distributed), SQLite (local cache)

#### Gun.js Graph Path: `reputation/{pubkey}`

| Field                      | Type             | Description                                           |
| -------------------------- | ---------------- | ----------------------------------------------------- |
| `pubkey`                   | TEXT PK          | Nostr pubkey of the user                              |
| `score`                    | REAL NOT NULL    | Composite reputation score (0.0-100.0)                |
| `poi_contributions`        | INTEGER NOT NULL | Number of POI additions/edits                         |
| `poi_confirmations`        | INTEGER NOT NULL | Number of times this user's POI data was corroborated |
| `poi_rejections`           | INTEGER NOT NULL | Number of times this user's data was disputed         |
| `traffic_probes_submitted` | INTEGER NOT NULL | Cumulative traffic probe count                        |
| `traffic_accuracy_score`   | REAL NOT NULL    | How closely probes match aggregate consensus          |
| `imagery_contributions`    | INTEGER NOT NULL | Number of street imagery uploads                      |
| `last_updated`             | INTEGER NOT NULL | Unix timestamp                                        |

**Score computation**: Weighted formula — `(confirmations / (confirmations + rejections)) * 40 + (traffic_accuracy * 30) + (log10(total_contributions) * 30)`. Score is recomputed locally by each peer from the Gun.js data.

---

### 9. StreetImagery

Geotagged street-level photo metadata.

**Storage**: Hypercore feed (image data), SQLite (metadata index), Gun.js (attribution)

| Field                | Type             | Description                                               |
| -------------------- | ---------------- | --------------------------------------------------------- |
| `id`                 | TEXT PK          | UUIDv4                                                    |
| `author_pubkey`      | TEXT NOT NULL    | Nostr pubkey of contributor                               |
| `lat`                | REAL NOT NULL    | Latitude                                                  |
| `lng`                | REAL NOT NULL    | Longitude                                                 |
| `geohash8`           | TEXT NOT NULL    | 8-char geohash                                            |
| `bearing`            | INTEGER NOT NULL | Camera heading (0-359 degrees)                            |
| `captured_at`        | INTEGER NOT NULL | Unix timestamp of capture                                 |
| `image_hash`         | TEXT NOT NULL    | SHA-256 hash of the blurred image                         |
| `hypercore_feed_key` | TEXT NOT NULL    | Discovery key of the Hypercore feed containing this image |
| `feed_seq`           | INTEGER NOT NULL | Sequence number within the feed                           |
| `width`              | INTEGER NOT NULL | Image width in pixels                                     |
| `height`             | INTEGER NOT NULL | Image height in pixels                                    |
| `blurred`            | INTEGER NOT NULL | 1 if face/plate blurring applied                          |
| `signature`          | TEXT NOT NULL    | Nostr signature of metadata                               |

**SQLite indexes**: `(geohash8, bearing)`, `(author_pubkey)`, R-tree on `(lat, lng)`

---

### 10. DataEdit

A proposed change to any shared dataset, tracked for audit and conflict resolution.

**Storage**: Gun.js (distributed log), SQLite (local audit cache)

#### Gun.js Graph Path: `edit/{entity_type}/{entity_id}/{timestamp}_{author_pubkey}`

| Field            | Type                       | Description                                                        |
| ---------------- | -------------------------- | ------------------------------------------------------------------ |
| `id`             | TEXT PK                    | Composite: `{entity_type}:{entity_id}:{timestamp}:{author_pubkey}` |
| `entity_type`    | TEXT NOT NULL              | `place` \| `review` \| `road_segment`                              |
| `entity_id`      | TEXT NOT NULL              | UUID or ID of the entity being edited                              |
| `author_pubkey`  | TEXT NOT NULL              | Nostr pubkey of submitter                                          |
| `field_name`     | TEXT NOT NULL              | Field being changed                                                |
| `old_value`      | TEXT                       | Previous value (null for additions)                                |
| `new_value`      | TEXT                       | Proposed new value (null for deletions)                            |
| `status`         | TEXT NOT NULL              | `pending` \| `accepted` \| `rejected`                              |
| `corroborations` | INTEGER NOT NULL DEFAULT 0 | Number of peers confirming this edit                               |
| `disputes`       | INTEGER NOT NULL DEFAULT 0 | Number of peers disputing this edit                                |
| `signature`      | TEXT NOT NULL              | Nostr signature of the edit payload                                |
| `created_at`     | INTEGER NOT NULL           | Unix timestamp                                                     |
| `resolved_at`    | INTEGER                    | Unix timestamp of resolution                                       |

**Validation rules**: Edits with `corroborations >= 1` and `author reputation >= 20.0` are auto-accepted. Edits from authors with `reputation < 10.0` require `corroborations >= 3`. Disputed edits (`disputes >= corroborations`) are held for manual community review.

---

### 11. GeocodingEntry

Pre-indexed address and place data for on-device search.

**Storage**: SQLite (read-only database per region, downloaded from Arweave)

| Field         | Type          | Description                                |
| ------------- | ------------- | ------------------------------------------ |
| `id`          | INTEGER PK    | Auto-increment                             |
| `text`        | TEXT NOT NULL | FTS5-indexed address or place name         |
| `type`        | TEXT NOT NULL | `address` \| `place` \| `street` \| `city` |
| `housenumber` | TEXT          | House number (for addresses)               |
| `street`      | TEXT          | Street name                                |
| `city`        | TEXT          | City name                                  |
| `state`       | TEXT          | State/province                             |
| `postcode`    | TEXT          | Postal code                                |
| `country`     | TEXT          | Country code                               |
| `lat`         | REAL NOT NULL | Latitude                                   |
| `lng`         | REAL NOT NULL | Longitude                                  |

**Indexes**: FTS5 virtual table on `text`, R-tree on `(lat, lng)`

---

### 12. RouteHistory

Saved routes for the user's history and quick re-navigation.

**Storage**: SQLite

| Field              | Type             | Description                         |
| ------------------ | ---------------- | ----------------------------------- |
| `id`               | TEXT PK          | UUIDv4                              |
| `origin_lat`       | REAL NOT NULL    | Start latitude                      |
| `origin_lng`       | REAL NOT NULL    | Start longitude                     |
| `origin_name`      | TEXT             | Human-readable origin name          |
| `destination_lat`  | REAL NOT NULL    | End latitude                        |
| `destination_lng`  | REAL NOT NULL    | End longitude                       |
| `destination_name` | TEXT             | Human-readable destination name     |
| `mode`             | TEXT NOT NULL    | `driving` \| `walking` \| `cycling` |
| `distance_meters`  | INTEGER NOT NULL | Total route distance                |
| `duration_seconds` | INTEGER NOT NULL | Estimated travel time               |
| `route_geometry`   | TEXT NOT NULL    | Encoded polyline of the route       |
| `created_at`       | INTEGER NOT NULL | Unix timestamp                      |

---

## Entity Relationships

```
Region 1──* MapTile          (tiles belong to a region)
Region 1──* RoadSegment      (segments belong to a region)
Region 1──* GeocodingEntry   (geocoding data scoped to region)

Place 1──* Review            (a place has many reviews)
Place 1──* DataEdit          (a place can have pending edits)
Place ──── UserReputation    (author_pubkey links to reputation)

Review ──── UserReputation   (author_pubkey links to reputation)

PeerNode ──── UserReputation (same pubkey)
PeerNode *──* Region         (a node caches multiple regions)

StreetImagery ──── PeerNode  (author_pubkey links to peer)
DataEdit ──── UserReputation (author_pubkey links to reputation)

TrafficObservation ──── RoadSegment (segment_id maps observation to road)
```

## State Transitions

### Region Download Status

```
none → downloading → complete
                  → failed → downloading (retry)
complete → downloading (update available)
```

### Place Status

```
open → closed_temporarily → open
open → closed_permanently
closed_temporarily → closed_permanently
```

### DataEdit Status

```
pending → accepted    (corroborations threshold met)
pending → rejected    (disputes exceed corroborations)
pending → pending     (more corroborations/disputes accumulate)
```

### TrafficObservation Congestion Level

```
free_flow ↔ slow ↔ congested ↔ stopped
(transitions based on rolling average speed thresholds per road class)
```
