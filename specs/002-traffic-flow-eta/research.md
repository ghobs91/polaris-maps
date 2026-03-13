# Research: Real-Time Traffic Flow Overlay with Dynamic ETA

**Feature**: 002-traffic-flow-eta
**Date**: 2026-03-10

## Research Tasks

### R1: TomTom Traffic Flow API Integration

**Decision**: Use TomTom Flow Segment Data endpoint (`/traffic/services/4/flowSegmentData/{style}/{zoom}/{point}.json`) to fetch traffic data for individual coordinate points within the viewport.

**Rationale**:

- TomTom's flowSegmentData returns traffic for a single road segment nearest to a given point, including `currentSpeed`, `freeFlowSpeed`, `currentTravelTime`, `freeFlowTravelTime`, and segment coordinates.
- To cover a viewport, we sample a grid of points at appropriate density based on zoom level.
- Response includes road geometry coordinates that can be used directly for map rendering.
- Confidence is implicitly high for TomTom (commercial-grade data). We assign confidence = 0.9.

**Alternatives considered**:

- TomTom Traffic Incidents API — only reports incidents, not flow speeds on all segments.
- TomTom Traffic Tiles — raster/vector tiles that would need a separate tile layer, adding map rendering complexity. Flow Segment Data gives structured JSON better suited for our normalized schema.
- Google Roads/Traffic API — requires Google Maps SDK which conflicts with MapLibre.

**API Contract**:

```
GET https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/{zoom}/{lat},{lng}.json?key={API_KEY}&unit=KMPH&thickness=1
```

**Response shape** (relevant fields):

```json
{
  "flowSegmentData": {
    "frc": "FRC2",
    "currentSpeed": 45,
    "freeFlowSpeed": 60,
    "currentTravelTime": 120,
    "freeFlowTravelTime": 90,
    "confidence": 0.95,
    "coordinates": {
      "coordinate": [
        { "latitude": 52.41072, "longitude": 4.84239 },
        { "latitude": 52.41073, "longitude": 4.84241 }
      ]
    }
  }
}
```

**Grid sampling strategy**: At zoom 14 (typical city view), sample ~16 points in a 4×4 grid across the viewport. At zoom 12 or lower, reduce to a 3×3 grid. At zoom 16+, increase to 5×5. Max 25 API calls per viewport update. Requests are parallelized via `Promise.allSettled()` so individual failures don't block others.

---

### R2: HERE Traffic Flow v7 API Integration

**Decision**: Use HERE Traffic Flow v7 `flow` endpoint with bounding box query to fetch all traffic data in a region with a single request.

**Rationale**:

- HERE's bbox query returns all traffic flow items within a bounding box in a single call, more efficient than TomTom's point-by-point approach.
- Response includes `currentSpeed`, `freeFlow`, `jamFactor` (0–10 scale), and road geometry for each flow item.
- When a route is active, extend the bbox to cover the full route bounding box (from `ValhallaRoute.boundingBox`), not just the viewport.
- Confidence derived from `jamFactor` reliability. We assign confidence = 0.85.

**Alternatives considered**:

- HERE Traffic Tiles — same problem as TomTom tiles; raster overlay requires separate rendering pipeline.
- HERE Route-level traffic — only available as part of HERE's routing, not compatible with Valhalla routes.

**API Contract**:

```
GET https://data.traffic.hereapi.com/v7/flow?locationReferencing=shape&in=bbox:{west},{south},{east},{north}&apiKey={API_KEY}
```

**Response shape** (relevant fields):

```json
{
  "results": [
    {
      "location": {
        "shape": {
          "links": [
            {
              "points": [
                { "lat": 52.52, "lng": 13.405 },
                { "lat": 52.521, "lng": 13.406 }
              ],
              "length": 150.0
            }
          ]
        }
      },
      "currentFlow": {
        "speed": 42.0,
        "freeFlow": 60.0,
        "jamFactor": 3.2,
        "confidence": 0.88
      }
    }
  ]
}
```

---

### R3: Normalized TrafficSegment Schema

**Decision**: Define a `NormalizedTrafficSegment` interface that both TomTom and HERE normalizers produce, and that the P2P aggregator can also emit.

**Rationale**:

- A shared schema enables a single merger/renderer pipeline regardless of data source.
- Including `confidence` enables the merger to weight sources appropriately.
- Including both `currentSpeed` and `freeFlowSpeed` enables congestion ratio computation at the consumer level.

**Schema**:

```typescript
interface NormalizedTrafficSegment {
  id: string; // unique: `{source}:{hash of coords}`
  coordinates: [number, number][]; // [lng, lat][] polyline
  currentSpeedKmh: number;
  freeFlowSpeedKmh: number;
  congestionRatio: number; // currentSpeed / freeFlowSpeed (0.0–1.0)
  confidence: number; // 0.0–1.0
  source: 'tomtom' | 'here' | 'p2p';
  timestamp: number; // Unix seconds
}
```

---

### R4: Multi-Source Merging Strategy

**Decision**: Merge segments from all sources using spatial proximity matching and confidence-weighted speed averaging.

**Rationale**:

- Two segments from different sources "overlap" if any point on one is within 30 meters of any point on the other (Haversine distance). This threshold accounts for coordinate imprecision between providers.
- When segments overlap, the merged speed is: `(speed_a × confidence_a + speed_b × confidence_b) / (confidence_a + confidence_b)`.
- Free-flow speed uses the maximum reported across sources (most permissive estimate).
- Non-overlapping segments pass through unchanged.
- P2P probes are converted to NormalizedTrafficSegment format by looking up the segment geometry from the road network data (or using a point geometry centered on the segment's geohash centroid).

**Alternatives considered**:

- Simple overlay (last-write-wins) — loses accuracy from multi-source data.
- Source-priority ranking — inflexible; confidence-weighted averaging adapts to per-segment data quality.

---

### R5: Spatial Matching for ETA Calculation

**Decision**: Match route segments to traffic segments by finding the nearest traffic segment to each route segment's midpoint, using Haversine distance with a 50-meter threshold.

**Rationale**:

- Route geometry from Valhalla is decoded into coordinate pairs via the existing `decodePolyline()` utility. Consecutive pairs form route sub-segments.
- For each route sub-segment, compute its midpoint coordinate and find the closest `NormalizedTrafficSegment` (by any point on that traffic segment's polyline).
- 50-meter threshold is generous enough to handle coordinate offset between Valhalla's road geometry and traffic API geometries, but tight enough to avoid matching the wrong road on a parallel street.
- If no traffic segment is within 50m, fall back to free-flow speed for that sub-segment.
- For efficiency, traffic segments are indexed by geohash6 of their first coordinate. Lookup only checks traffic segments in the same and adjacent geohash6 cells as the route sub-segment midpoint.

**Alternatives considered**:

- Segment ID matching — would require a shared road segment ID system that doesn't exist across TomTom, HERE, and OSM.
- Full line-to-line distance — more accurate but computationally expensive for thousands of segments. Midpoint-to-nearest-point is O(1) per segment with geohash indexing.

---

### R6: MapLibre Traffic Rendering with LineLayer

**Decision**: Replace the placeholder `TrafficOverlay` `CircleLayer` with a `LineLayer` that renders traffic segments as colored road lines using MapLibre data-driven styling.

**Rationale**:

- The existing `TrafficOverlay.tsx` renders points (`CircleLayer`), not road segments. The spec requires color-coded road segments.
- MapLibre's `LineLayer` with `lineColor` driven by a `['get', 'congestionRatio']` expression can color segments based on congestion thresholds.
- GeoJSON FeatureCollection of LineString features, each with a `congestionRatio` property, drives the rendering.
- Use `['step', ['get', 'congestionRatio'], '#991B1B', 0.25, '#FF3B30', 0.50, '#FF9500', 0.75, '#34C759']` for color interpolation matching the four congestion bands.
- `lineWidth` set to `['interpolate', ['linear'], ['zoom'], 10, 2, 16, 6]` for zoom-responsive thickness.
- `lineCap: 'round'` and `lineJoin: 'round'` for smooth segment joins.

**Alternatives considered**:

- Heatmap layer — doesn't follow road geometry; produces blobs rather than road-aware coloring.
- Custom tile source — complex; overkill for the number of segments we'll have (<200 per viewport).
- Painting on a canvas overlay — not GPU-accelerated; would break 60fps requirement.

---

### R7: Environment Variable Configuration

**Decision**: Add `react-native-dotenv` babel plugin and create `.env` / `.env.example` files for TomTom and HERE API keys.

**Rationale**:

- The codebase currently uses no API keys (all services are key-free: Nominatim, OpenFreeMap, OSM Valhalla).
- TomTom and HERE require API keys.
- `react-native-dotenv` is the standard Expo/React Native approach for injecting `.env` variables at build time.
- Keys accessed via `import { TOMTOM_API_KEY, HERE_API_KEY } from '@env'`.
- `.env.example` committed to repo; `.env` in `.gitignore`.

**Alternatives considered**:

- `expo-constants` / `app.config.js` extra field — works but mixes API keys with app configuration.
- `expo-secure-store` — runtime store, not build-time injection; overkill for API keys that are embedded in the app binary anyway.

---

### R8: Debouncing and Rate Limiting

**Decision**: Debounce viewport-change-triggered fetches by 800ms. Add a periodic 60-second timer for active route traffic refresh. Cap grid sampling to 25 TomTom calls per viewport update.

**Rationale**:

- Existing `topicManager.ts` debounces Waku subscriptions at 500ms. External API fetching should use a slightly longer debounce (800ms) since API calls are more expensive than local pub/sub operations.
- During active navigation, traffic conditions may change without viewport changes. A 60-second periodic refresh ensures the ETA stays current.
- TomTom free tier allows 2,500 requests/day. With 25 calls per viewport update and ~5 updates/minute during active use, this budget is consumed quickly. Debouncing and caching results for 60 seconds prevents exceeding limits.
- HERE free tier allows 250,000 requests/month (~8,000/day). Single-call bbox approach is much more efficient.

---

### R9: ETA Calculation Pure Function Design

**Decision**: Implement `calculateTrafficETA()` as a pure, synchronous function in `src/utils/etaCalculator.ts` with no dependencies on stores, services, or React.

**Rationale**:

- Spec explicitly requires a pure function that is independently testable.
- Constitution II (Testing Standards) requires unit tests for all public functions.
- Function signature: `calculateTrafficETA(routeSegments: ETARouteSegment[], trafficSegments: NormalizedTrafficSegment[]): ETAResult`.
- Algorithm: single O(n) pass over route segments. For each, find nearest traffic segment via geohash index, compute `distance / speed`, sum all segment travel times.
- Returns both `totalSeconds` and `perSegmentSeconds[]` for debugging/display.
- Formatting (minutes vs hours+minutes) handled by a separate `formatETA()` function in the same file.

**Alternatives considered**:

- Putting ETA logic inside the navigation store — violates single-responsibility and makes it untestable without mocking Zustand.
- Async function with traffic fetching built in — violates purity and spec requirement.

---

## Summary of Resolved Unknowns

| Unknown                                   | Resolution                                                                    |
| ----------------------------------------- | ----------------------------------------------------------------------------- |
| TomTom API endpoint and response format   | Flow Segment Data v4, point-by-point with grid sampling                       |
| HERE API endpoint and response format     | Traffic Flow v7, single bbox call                                             |
| Normalized schema for multi-source merge  | `NormalizedTrafficSegment` with coordinates, speeds, confidence, source       |
| Merging strategy for overlapping segments | Confidence-weighted speed averaging, 30m proximity threshold                  |
| Spatial matching for ETA                  | Midpoint-to-nearest-point Haversine, 50m threshold, geohash6 indexing         |
| Map rendering approach                    | MapLibre `LineLayer` with `['step']` expression for congestion-based coloring |
| API key configuration                     | `react-native-dotenv` with `@env` module, `.env` / `.env.example`             |
| Debouncing strategy                       | 800ms debounce for viewport changes, 60s periodic refresh during navigation   |
| ETA function design                       | Pure sync function in `src/utils/etaCalculator.ts`, O(n) single pass          |
