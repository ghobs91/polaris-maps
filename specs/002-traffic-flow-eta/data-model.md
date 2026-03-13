# Data Model: Real-Time Traffic Flow Overlay with Dynamic ETA

**Feature**: 002-traffic-flow-eta
**Date**: 2026-03-10

## Entity Relationship Diagram

```
┌───────────────────────┐      fetches      ┌──────────────────────────┐
│  TomTom Flow API      │ ───────────────►  │  NormalizedTrafficSegment│
└───────────────────────┘                    │  (shared schema)         │
                                             │                          │
┌───────────────────────┐      fetches      │  id                      │
│  HERE Flow API        │ ───────────────►  │  coordinates: [lng,lat][]│
└───────────────────────┘                    │  currentSpeedKmh         │
                                             │  freeFlowSpeedKmh        │
┌───────────────────────┐      converts     │  congestionRatio         │
│  P2P AggregatedState  │ ───────────────►  │  confidence              │
│  (existing)           │                    │  source                  │
└───────────────────────┘                    │  timestamp               │
                                             └──────────┬───────────────┘
                                                        │
                                          ┌─────────────┼──────────────┐
                                          │             │              │
                                          ▼             ▼              ▼
                                   ┌────────────┐ ┌──────────┐ ┌────────────┐
                                   │ TrafficOver│ │ Traffic   │ │ calculate  │
                                   │ lay (map)  │ │ Merger    │ │ TrafficETA │
                                   └────────────┘ └──────────┘ └──────┬─────┘
                                                                      │
                                                                      ▼
                                                               ┌────────────┐
                                                               │ ETAResult  │
                                                               └────────────┘
```

## New Entities

### NormalizedTrafficSegment

A unified representation of a traffic-observed road segment, produced by normalizing data from any source (TomTom, HERE, or P2P probes).

| Field              | Type                          | Description                                                                           | Validation                         |
| ------------------ | ----------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------- |
| `id`               | `string`                      | Unique identifier: `{source}:{hash}` where hash is derived from first/last coordinate | Non-empty                          |
| `coordinates`      | `[number, number][]`          | Polyline as `[lng, lat]` pairs describing road geometry                               | Min 2 points                       |
| `currentSpeedKmh`  | `number`                      | Current observed traffic speed in km/h                                                | ≥ 0, ≤ 300                         |
| `freeFlowSpeedKmh` | `number`                      | Expected free-flow speed in km/h                                                      | > 0, ≤ 300                         |
| `congestionRatio`  | `number`                      | `currentSpeedKmh / freeFlowSpeedKmh` (0.0–1.0+)                                       | ≥ 0; clamped to [0, 1] for display |
| `confidence`       | `number`                      | Data quality confidence (0.0–1.0)                                                     | [0, 1]                             |
| `source`           | `'tomtom' \| 'here' \| 'p2p'` | Originating data source                                                               | Enum value                         |
| `timestamp`        | `number`                      | Unix timestamp (seconds) of when this data was observed                               | > 0                                |

**State transitions**: None. Traffic segments are ephemeral — replaced on each fetch cycle. Old data is discarded when new data arrives for the same viewport/route area.

**Relationships**: Consumed by `TrafficOverlay` (map rendering), `trafficMerger` (multi-source aggregation), and `calculateTrafficETA` (ETA computation).

---

### ETARouteSegment

A lightweight representation of one sub-segment of a computed route, used as input to the ETA calculator.

| Field              | Type               | Description                                                        | Validation   |
| ------------------ | ------------------ | ------------------------------------------------------------------ | ------------ |
| `startCoord`       | `[number, number]` | Start point `[lng, lat]`                                           | Valid coords |
| `endCoord`         | `[number, number]` | End point `[lng, lat]`                                             | Valid coords |
| `distanceMeters`   | `number`           | Length of this sub-segment in meters                               | > 0          |
| `freeFlowSpeedKmh` | `number`           | Default free-flow speed for this road (from route data or default) | > 0          |

**Derived from**: Decoding `ValhallaRoute.geometry` (encoded polyline) into coordinate pairs, then computing distances between consecutive pairs using Haversine formula.

**Relationships**: Input to `calculateTrafficETA()`. Each ETARouteSegment is matched against NormalizedTrafficSegments by coordinate proximity.

---

### ETAResult

Output of the `calculateTrafficETA()` function.

| Field                  | Type     | Description                                            |
| ---------------------- | -------- | ------------------------------------------------------ |
| `totalSeconds`         | `number` | Total traffic-adjusted travel time in seconds          |
| `freeFlowTotalSeconds` | `number` | Total free-flow travel time (for comparison/display)   |
| `segmentCount`         | `number` | Number of route segments processed                     |
| `matchedSegmentCount`  | `number` | Number of segments that had matching traffic data      |
| `formatted`            | `string` | Human-readable string, e.g., "23 min" or "1 hr 12 min" |
| `freeFlowFormatted`    | `string` | Human-readable free-flow time for comparison           |

---

### CongestionThresholds

Constants that map a `congestionRatio` to a visual congestion band. Not a stored entity — a configuration constant.

| Congestion Band | Ratio Range         | Color Token                | Hex       |
| --------------- | ------------------- | -------------------------- | --------- |
| Free Flow       | ratio ≥ 0.75        | `colors.traffic.freeFlow`  | `#34C759` |
| Slow            | 0.50 ≤ ratio < 0.75 | `colors.traffic.slow`      | `#FF9500` |
| Congested       | 0.25 ≤ ratio < 0.50 | `colors.traffic.congested` | `#FF3B30` |
| Stopped         | ratio < 0.25        | `colors.traffic.stopped`   | `#991B1B` |

---

## Modified Existing Entities

### TrafficStore (Zustand)

**Current state**: Contains `segmentTraffic: Record<string, AggregatedTrafficState>` for P2P probe data only.

**Additions**:

| Field                     | Type                                             | Description                                                   |
| ------------------------- | ------------------------------------------------ | ------------------------------------------------------------- |
| `normalizedSegments`      | `NormalizedTrafficSegment[]`                     | Merged traffic segments from all sources for current viewport |
| `isExternalFetchLoading`  | `boolean`                                        | Whether an external API fetch is in progress                  |
| `lastExternalFetchAt`     | `number \| null`                                 | Timestamp of last successful external fetch                   |
| `setNormalizedSegments`   | `(segments: NormalizedTrafficSegment[]) => void` | Action to update merged segments                              |
| `setExternalFetchLoading` | `(loading: boolean) => void`                     | Action to update loading state                                |

### NavigationStore (Zustand)

**Current state**: Contains `etaSeconds: number | null` for free-flow ETA.

**Additions**:

| Field                | Type                                                                    | Description                                               |
| -------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------- |
| `trafficEtaSeconds`  | `number \| null`                                                        | Traffic-adjusted ETA in seconds (null if no traffic data) |
| `freeFlowEtaSeconds` | `number \| null`                                                        | Original free-flow ETA for comparison display             |
| `trafficMatchRatio`  | `number \| null`                                                        | Fraction of route segments with traffic data (0.0–1.0)    |
| `updateTrafficEta`   | `(trafficEta: number, freeFlowEta: number, matchRatio: number) => void` | Action                                                    |

---

## Existing Entities (Unchanged, Referenced)

### AggregatedTrafficState (existing — `models/traffic.ts`)

Used by P2P probe system. Will be converted to `NormalizedTrafficSegment` format by the merger for integration with external API data.

### ValhallaRoute (existing — `models/route.ts`)

Provides route geometry (encoded polyline) and bounding box. The geometry is decoded into coordinate pairs to produce `ETARouteSegment[]` as input for ETA calculation.

### RoadSegment (existing — `models/route.ts`)

Contains `startLat`, `startLng`, `endLat`, `endLng`, `speedLimitKmh`. May be used as a fallback source for free-flow speed when decoding route segments, but primarily `ETARouteSegment.freeFlowSpeedKmh` comes from road class defaults.
