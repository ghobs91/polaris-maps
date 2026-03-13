# External API Contracts: Traffic Data Sources

**Feature**: 002-traffic-flow-eta
**Date**: 2026-03-10

This document defines the external API contracts for the two traffic data sources used by this feature. These contracts serve as the authoritative reference for building API fetchers and normalizers.

---

## 1. TomTom Traffic Flow Segment Data v4

### Endpoint

```
GET https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/{zoom}/{lat},{lng}.json
```

### Authentication

| Parameter | Location     | Description                |
| --------- | ------------ | -------------------------- |
| `key`     | Query string | TomTom API key from `.env` |

### Request Parameters

| Parameter   | Type     | Required | Description                                                 |
| ----------- | -------- | -------- | ----------------------------------------------------------- |
| `zoom`      | `int`    | Yes      | Zoom level (path parameter). Use map zoom, clamped to 0–22. |
| `lat`       | `float`  | Yes      | Latitude of sample point (path parameter)                   |
| `lng`       | `float`  | Yes      | Longitude of sample point (path parameter)                  |
| `unit`      | `string` | No       | Speed unit. Use `KMPH`. Default: `KMPH`                     |
| `thickness` | `int`    | No       | Line thickness bucket (1–10). Use `1`                       |

### Response Schema (relevant fields)

```typescript
interface TomTomFlowResponse {
  flowSegmentData: {
    /** Functional Road Class (FRC0–FRC6) */
    frc: string;
    /** Current observed speed in km/h */
    currentSpeed: number;
    /** Expected free-flow speed in km/h */
    freeFlowSpeed: number;
    /** Current travel time in seconds */
    currentTravelTime: number;
    /** Free-flow travel time in seconds */
    freeFlowTravelTime: number;
    /** Data confidence (0.0–1.0) */
    confidence: number;
    /** Road segment geometry */
    coordinates: {
      coordinate: Array<{
        latitude: number;
        longitude: number;
      }>;
    };
  };
}
```

### Error Handling

| Status | Meaning                    | Action                    |
| ------ | -------------------------- | ------------------------- |
| 200    | Success                    | Parse and normalize       |
| 400    | Invalid parameters         | Drop this sample point    |
| 403    | Invalid or expired API key | Log warning, skip source  |
| 429    | Rate limit exceeded        | Back off, skip this cycle |
| 5xx    | Server error               | Skip this sample point    |

### Rate Limits

- Free tier: 2,500 requests/day
- Grid sampling capped at 25 points/viewport × debounced to max ~1 update per 60s effective = ~1,500/day max

### Normalization Mapping

```
TomTomFlowResponse → NormalizedTrafficSegment:
  id           = `tomtom:${hash(coordinates[0], coordinates[-1])}`
  coordinates  = response.flowSegmentData.coordinates.coordinate.map(c => [c.longitude, c.latitude])
  currentSpeedKmh  = response.flowSegmentData.currentSpeed
  freeFlowSpeedKmh = response.flowSegmentData.freeFlowSpeed
  congestionRatio  = currentSpeed / freeFlowSpeed
  confidence       = response.flowSegmentData.confidence ?? 0.9
  source           = 'tomtom'
  timestamp        = Math.floor(Date.now() / 1000)
```

---

## 2. HERE Traffic Flow v7

### Endpoint

```
GET https://data.traffic.hereapi.com/v7/flow
```

### Authentication

| Parameter | Location     | Description              |
| --------- | ------------ | ------------------------ |
| `apiKey`  | Query string | HERE API key from `.env` |

### Request Parameters

| Parameter             | Type     | Required | Description                                              |
| --------------------- | -------- | -------- | -------------------------------------------------------- |
| `in`                  | `string` | Yes      | Bounding box: `bbox:{west},{south},{east},{north}`       |
| `locationReferencing` | `string` | No       | Use `shape` to get geometry coordinates. Default: `none` |

### Response Schema (relevant fields)

```typescript
interface HEREFlowResponse {
  results: Array<{
    location: {
      shape: {
        links: Array<{
          points: Array<{
            lat: number;
            lng: number;
          }>;
          length: number; // meters
        }>;
      };
    };
    currentFlow: {
      /** Current speed in km/h */
      speed: number;
      /** Free-flow speed in km/h */
      freeFlow: number;
      /** Jam factor (0 = free flow, 10 = stopped) */
      jamFactor: number;
      /** Data confidence (0.0–1.0) */
      confidence: number;
    };
  }>;
}
```

### Error Handling

| Status | Meaning              | Action                     |
| ------ | -------------------- | -------------------------- |
| 200    | Success              | Parse and normalize        |
| 400    | Invalid bounding box | Log warning, skip source   |
| 401    | Invalid API key      | Log warning, skip source   |
| 429    | Rate limit exceeded  | Back off, skip this cycle  |
| 5xx    | Server error         | Skip source for this cycle |

### Rate Limits

- Free tier: 250,000 requests/month (~8,000/day)
- Single bbox call per viewport update → very efficient

### Normalization Mapping

```
HEREFlowResponse.results[i] → NormalizedTrafficSegment (one per link):
  id               = `here:${hash(link.points[0], link.points[-1])}`
  coordinates      = link.points.map(p => [p.lng, p.lat])
  currentSpeedKmh  = result.currentFlow.speed
  freeFlowSpeedKmh = result.currentFlow.freeFlow
  congestionRatio  = speed / freeFlow
  confidence       = result.currentFlow.confidence ?? 0.85
  source           = 'here'
  timestamp        = Math.floor(Date.now() / 1000)
```

---

## 3. Internal Contract: P2P Probe → NormalizedTrafficSegment

The existing `AggregatedTrafficState` from the P2P Waku probe system is converted to `NormalizedTrafficSegment` format for merging with external API data.

### Conversion Mapping

```
AggregatedTrafficState → NormalizedTrafficSegment:
  id               = `p2p:${segmentId}`
  coordinates      = [geohash6 centroid as single [lng, lat] point, or segment geometry if available]
  currentSpeedKmh  = aggregatedState.avgSpeedKmh
  freeFlowSpeedKmh = road class default speed (looked up from road network data)
  congestionRatio  = currentSpeedKmh / freeFlowSpeedKmh
  confidence       = min(1.0, sampleCount / 5) × 0.7  (max 0.7 for P2P; scales with sample count)
  source           = 'p2p'
  timestamp        = aggregatedState.lastUpdated
```

### Notes

- P2P confidence caps at 0.7 (lower than external APIs) because probe data from a small number of peers is inherently less reliable than commercial traffic systems.
- Confidence scales linearly from 0.0 (1 sample) to 0.7 (5+ samples) to reflect that more probes improve accuracy.
- Road class default speeds for free-flow estimation:

| Road Class    | Default Free-Flow Speed (km/h) |
| ------------- | ------------------------------ |
| `motorway`    | 110                            |
| `trunk`       | 90                             |
| `primary`     | 70                             |
| `secondary`   | 50                             |
| `tertiary`    | 40                             |
| `residential` | 30                             |
| `service`     | 20                             |
