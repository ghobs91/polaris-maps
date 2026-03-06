# Gun.js Data Contracts

**Technology**: Gun.js (decentralized real-time graph database)  
**Storage adapter**: MMKV  
**Peer discovery**: Gun relay peers (community-operated)  
**Data signing**: Nostr secp256k1 Schnorr signatures

---

## Graph Namespace Structure

```
polaris/
├── poi/{geohash8}/{uuid}              → Place record
├── review/{poi_uuid}/{author_pubkey}  → Review record
├── reputation/{pubkey}                → Reputation record
├── edit/{entity_type}/{entity_id}/{ts}_{pubkey} → DataEdit record
└── meta/
    ├── relays                         → Known relay peer list
    └── version                        → Schema version
```

---

## Contract 1: Place Record

**Path**: `polaris/poi/{geohash8}/{uuid}`  
**Write access**: Any authenticated peer (signature verified)  
**Read access**: Any peer

```typescript
interface PlaceRecord {
  uuid: string; // UUIDv4
  name: string; // Max 200 chars
  category: string; // From controlled vocabulary (see below)
  lat: number; // -90 to 90
  lng: number; // -180 to 180
  geohash8: string; // 8-char geohash (computed from lat/lng)

  address_street?: string; // Max 200 chars
  address_city?: string; // Max 100 chars
  address_state?: string; // Max 100 chars
  address_postcode?: string; // Max 20 chars
  address_country?: string; // ISO 3166-1 alpha-2 (e.g., "US")

  phone?: string; // E.164 format (e.g., "+12125551234")
  website?: string; // Valid URL, max 500 chars
  hours?: string; // JSON: {"mon":"9:00-17:00","tue":"9:00-17:00",...}

  avg_rating?: number; // Computed: 1.0-5.0 (not directly writable)
  review_count?: number; // Computed (not directly writable)

  status: 'open' | 'closed_temporarily' | 'closed_permanently';
  source: 'overture' | 'community';

  author_pubkey: string; // Nostr hex pubkey (64 chars)
  signature: string; // Nostr Schnorr signature (hex, 128 chars)
  created_at: number; // Unix timestamp (seconds)
  updated_at: number; // Unix timestamp (seconds)
}
```

### Place Category Vocabulary

```
restaurant, cafe, bar, bakery, fast_food,
grocery, supermarket, convenience, pharmacy,
hospital, clinic, dentist,
bank, atm, post_office,
gas_station, ev_charging, parking,
hotel, hostel, campground,
school, university, library,
gym, park, playground, swimming_pool,
cinema, museum, theater,
clothing, electronics, hardware, bookstore,
hair_salon, laundry, car_repair, car_wash,
police, fire_station, government,
place_of_worship, cemetery,
airport, bus_station, train_station,
beach, mountain, viewpoint,
other
```

### Write Validation

1. `signature` MUST be valid Schnorr signature over `SHA256(uuid + name + lat + lng + updated_at)` using `author_pubkey`
2. `geohash8` MUST match `geohash(lat, lng)` at precision 8
3. `category` MUST be from the controlled vocabulary
4. `updated_at` MUST be > previous `updated_at` for updates (HAM conflict resolution)
5. For `source: 'overture'`, `author_pubkey` MUST be the known Overture data import key

---

## Contract 2: Review Record

**Path**: `polaris/review/{poi_uuid}/{author_pubkey}`  
**Write access**: Author only (enforced by signature)  
**Read access**: Any peer

```typescript
interface ReviewRecord {
  poi_uuid: string; // UUIDv4 of the reviewed place
  author_pubkey: string; // Nostr hex pubkey
  rating: number; // Integer 1-5
  text?: string; // Max 2000 chars
  signature: string; // Nostr Schnorr signature
  created_at: number; // Unix timestamp
  updated_at: number; // Unix timestamp
}
```

### Write Validation

1. `rating` MUST be integer 1-5
2. `text` MUST be <= 2000 characters if present
3. `signature` MUST be valid over `SHA256(poi_uuid + author_pubkey + rating + text + updated_at)`
4. Path `{author_pubkey}` segment MUST match the record's `author_pubkey` (one review per author per place)

---

## Contract 3: Reputation Record

**Path**: `polaris/reputation/{pubkey}`  
**Write access**: Computed locally by each peer (not directly writable over the network)  
**Read access**: Any peer

```typescript
interface ReputationRecord {
  pubkey: string; // Nostr hex pubkey
  score: number; // 0.0-100.0
  poi_contributions: number; // Count of POI adds/edits
  poi_confirmations: number; // Count of corroborated POIs
  poi_rejections: number; // Count of disputed POIs
  traffic_probes_submitted: number;
  traffic_accuracy_score: number; // 0.0-1.0
  imagery_contributions: number;
  last_updated: number; // Unix timestamp
}
```

**Note**: Reputation is a **derived value** — each peer computes it independently by observing the author's contribution history in the Gun.js graph. The stored record is a cache for display purposes. Reputation is NOT consensus-based; it's locally computed.

### Score Computation

```
score = (confirmations / max(1, confirmations + rejections)) * 40
      + (traffic_accuracy_score) * 30
      + min(30, log10(max(1, total_contributions)) * 10)
```

---

## Contract 4: DataEdit Record

**Path**: `polaris/edit/{entity_type}/{entity_id}/{timestamp}_{author_pubkey}`  
**Write access**: Any authenticated peer  
**Read access**: Any peer

```typescript
interface DataEditRecord {
  entity_type: 'place' | 'review' | 'road_segment';
  entity_id: string;
  author_pubkey: string;
  field_name: string;
  old_value?: string; // JSON-stringified previous value
  new_value?: string; // JSON-stringified proposed value
  status: 'pending' | 'accepted' | 'rejected';
  corroborations: number;
  disputes: number;
  signature: string;
  created_at: number;
  resolved_at?: number;
}
```

### Auto-Resolution Rules

| Condition                                                 | Action      |
| --------------------------------------------------------- | ----------- |
| `corroborations >= 1` AND author `reputation.score >= 20` | Auto-accept |
| `corroborations >= 3` AND author `reputation.score < 20`  | Auto-accept |
| `disputes >= corroborations` AND `disputes >= 2`          | Auto-reject |
| Age > 7 days AND no corroborations                        | Auto-reject |

---

## Gun.js Relay Peer Bootstrap

### Discovery

On launch, the app connects to relay peers in this priority order:

1. **Previously-connected peers** (cached in MMKV from last session)
2. **Hardcoded seed list** (shipped with the app, updated via Arweave manifest)
3. **DHT discovery** (Gun's built-in relay announcement mechanism)

### Relay Peer Record

**Path**: `polaris/meta/relays`

```typescript
interface RelayPeerList {
  [peerId: string]: {
    url: string; // WebSocket URL (e.g., "wss://relay.example.com/gun")
    region: string; // Geographic region hint (e.g., "us-west")
    last_seen: number; // Unix timestamp
    latency_ms?: number; // Last measured RTT
  };
}
```
