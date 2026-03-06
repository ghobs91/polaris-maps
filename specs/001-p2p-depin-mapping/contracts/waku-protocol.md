# Waku Protocol Contracts

**Protocol**: Waku v2 (light-push + filter mode)  
**Transport**: libp2p GossipSub via nodejs-mobile sidecar  
**Encoding**: Protobuf

---

## Content Topic Naming Convention

All Polaris Maps Waku content topics follow this pattern:

```
/polaris/{version}/{data_type}/{geographic_shard}/proto
```

| Segment            | Description                             | Example                      |
| ------------------ | --------------------------------------- | ---------------------------- |
| `polaris`          | Application namespace                   | `polaris`                    |
| `version`          | Protocol version (integer)              | `1`                          |
| `data_type`        | Message category                        | `traffic`, `poi-attestation` |
| `geographic_shard` | Geohash prefix for geographic filtering | `9q5ctr` (6-char geohash)    |
| `proto`            | Encoding format                         | `proto` (always Protobuf)    |

---

## Message 1: TrafficProbe

**Content topic**: `/polaris/1/traffic/{geohash6}/proto`  
**Direction**: Device → Network (publish), Network → Device (subscribe)  
**Publish rate**: 1 message per 5 seconds while device speed > 5 km/h  
**TTL**: 5 minutes (messages older than 5 minutes are discarded by consumers)

### Protobuf Schema

```protobuf
syntax = "proto3";

package polaris.traffic.v1;

message TrafficProbe {
  // 6-character geohash of the observation point
  string geohash6 = 1;

  // Road segment ID (Valhalla edge ID) this probe maps to
  string segment_id = 2;

  // Observed speed in km/h (0 = stopped)
  float speed_kmh = 3;

  // Heading in degrees (0-359, 0 = north, clockwise)
  uint32 bearing = 4;

  // Unix timestamp in seconds
  uint64 timestamp = 5;

  // Ephemeral session ID (32 bytes, rotated every 60 minutes)
  // NOT linked to Nostr identity — prevents tracking
  bytes probe_id = 6;
}
```

**Wire size**: 40-60 bytes per message  
**Subscription scope**: Device subscribes to geohash6 cells visible on screen + 8 adjacent cells (9 topics total)

### Validation Rules (consumer-side)

1. `timestamp` MUST be within 5 minutes of current time
2. `speed_kmh` MUST be >= 0 and <= 300
3. `bearing` MUST be >= 0 and < 360
4. `geohash6` MUST be a valid 6-character geohash
5. `segment_id` MUST not be empty
6. `probe_id` MUST be exactly 32 bytes

---

## Message 2: POIAttestation

**Content topic**: `/polaris/1/poi-attestation/{geohash6}/proto`  
**Direction**: Device → Network (publish)  
**Purpose**: Nearby users confirm a POI exists at the stated location (GPS-proximity cross-check)  
**Publish rate**: On user action (manual attestation) or automatic when within 50m of an unconfirmed POI

### Protobuf Schema

```protobuf
syntax = "proto3";

package polaris.poi.v1;

message POIAttestation {
  // UUID of the POI being attested
  string poi_uuid = 1;

  // Attester's Nostr pubkey (hex, 64 chars)
  string attester_pubkey = 2;

  // Attester's GPS coordinates at time of attestation
  double attester_lat = 3;
  double attester_lng = 4;

  // Distance in meters between attester and claimed POI location
  float distance_meters = 5;

  // Attestation type
  AttestationType type = 6;

  // Unix timestamp
  uint64 timestamp = 7;

  // Nostr Schnorr signature of (poi_uuid + attester_pubkey + timestamp)
  bytes signature = 8;

  enum AttestationType {
    CONFIRM_EXISTS = 0;
    CONFIRM_CLOSED = 1;
    DISPUTE = 2;
  }
}
```

**Wire size**: 150-200 bytes per message

### Validation Rules

1. `distance_meters` MUST be <= 200 (attester must be within 200m of POI)
2. `signature` MUST be a valid Schnorr signature verifiable with `attester_pubkey`
3. `timestamp` MUST be within 10 minutes of current time
4. `poi_uuid` MUST be a valid UUIDv4

---

## Message 3: TrafficIncident

**Content topic**: `/polaris/1/incident/{geohash6}/proto`  
**Direction**: Device → Network (publish)  
**Purpose**: User-reported traffic incidents (accidents, road closures, hazards)

### Protobuf Schema

```protobuf
syntax = "proto3";

package polaris.traffic.v1;

message TrafficIncident {
  string id = 1;                    // UUIDv4
  string reporter_pubkey = 2;       // Nostr pubkey
  double lat = 3;
  double lng = 4;
  string geohash6 = 5;
  IncidentType type = 6;
  string description = 7;           // Max 280 chars
  uint64 reported_at = 8;           // Unix timestamp
  uint64 expires_at = 9;            // Auto-expire timestamp
  bytes signature = 10;             // Nostr Schnorr signature

  enum IncidentType {
    ACCIDENT = 0;
    ROAD_CLOSURE = 1;
    HAZARD = 2;
    CONSTRUCTION = 3;
    POLICE = 4;
    OTHER = 5;
  }
}
```

---

## Subscription Management

### Topic Lifecycle

```
Map viewport changes
  → Compute visible geohash6 cells + adjacent ring
  → Unsubscribe from topics no longer visible
  → Subscribe to new visible topics
  → Debounce: 500ms after last viewport change
```

### Maximum Concurrent Subscriptions

- Traffic probes: 25 topics (5×5 geohash grid centered on viewport)
- POI attestations: 9 topics (3×3 grid centered on user location)
- Incidents: 25 topics (same as traffic)
- **Total maximum**: 59 concurrent filter subscriptions

---

## nodejs-mobile Bridge Contract

### RN → Sidecar Messages

```typescript
interface WakuCommand {
  type: 'subscribe' | 'unsubscribe' | 'publish' | 'status';
  topic?: string; // Content topic
  payload?: Uint8Array; // Protobuf-encoded message (for publish)
  requestId: string; // Correlation ID for response
}
```

### Sidecar → RN Messages

```typescript
interface WakuEvent {
  type: 'message' | 'response' | 'error' | 'status';
  topic?: string; // Content topic (for incoming messages)
  payload?: Uint8Array; // Protobuf-encoded message (for incoming)
  requestId?: string; // Correlation ID (for responses)
  error?: string; // Error description
  peerCount?: number; // Connected peers (for status)
}
```
