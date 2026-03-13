# Feature Specification: Real-Time Traffic Flow Overlay with Dynamic ETA

**Feature Branch**: `002-traffic-flow-eta`
**Created**: 2026-03-10
**Status**: Draft
**Input**: User description: "Real-Time Traffic Flow Overlay with Dynamic ETA — color-coded road congestion on the map with traffic-adjusted route ETAs"

## User Scenarios & Testing _(mandatory)_

### User Story 1 — View Traffic Congestion on the Map (Priority: P1)

A user opens the app and wants to see at a glance which roads near them are congested before choosing a route. The map displays roads color-coded by current traffic flow: green for free-flow, yellow for slow, orange for congested, and red for stopped traffic. As the user pans or zooms, the traffic coloring updates to reflect conditions in the newly visible area.

**Why this priority**: This is the foundational visual feature. Without color-coded roads, users have no way to perceive traffic conditions, and all downstream features (ETA adjustment, dynamic updates) are meaningless.

**Independent Test**: Can be fully tested by opening the map in an area with known traffic data and verifying that road segments display the correct colors. Delivers immediate visual value even without active navigation.

**Acceptance Scenarios**:

1. **Given** the user is viewing the map with traffic data available, **When** the map renders, **Then** road segments are colored green, yellow, orange, or red based on current congestion level relative to free-flow speed.
2. **Given** the map is displaying traffic colors, **When** the user pans or zooms to a new area, **Then** the traffic coloring updates to reflect conditions in the newly visible area.
3. **Given** traffic data is available, **When** the user looks at the map, **Then** a legend is visible in one corner explaining the four color levels (green = free flow, yellow = slow, orange = congested, red = stopped).
4. **Given** traffic data is entirely unavailable (both external APIs down and no P2P probe data), **When** the user views the map, **Then** the map renders normally without traffic colors and no error is shown.

---

### User Story 2 — Traffic-Adjusted Route ETA (Priority: P2)

A user plans a route and wants the displayed ETA to account for current traffic speeds on each road segment along the route, not just free-flow speed. When a route is computed, the system calculates a traffic-adjusted ETA by looking up the current congestion for each road segment in the route geometry and deriving a travel time using the actual current speed. The traffic-adjusted ETA is displayed to the user, clearly distinguished from the free-flow estimate.

**Why this priority**: After seeing congestion visually, the next most valuable feature is understanding how that congestion translates to time. An accurate ETA is a primary reason users choose one mapping app over another.

**Independent Test**: Can be tested by computing a route through segments with known traffic data and verifying the displayed ETA is higher than the free-flow estimate by the expected amount based on the congestion.

**Acceptance Scenarios**:

1. **Given** a route is active and traffic data is available for road segments along the route, **When** the route is displayed, **Then** the system shows a traffic-adjusted ETA computed from current traffic speeds rather than free-flow speeds.
2. **Given** a route passes through segments with no matching traffic data, **When** the ETA is calculated, **Then** those segments fall back to free-flow speed for their contribution to the total ETA.
3. **Given** traffic data is entirely unavailable, **When** a route is displayed, **Then** the ETA falls back to the free-flow calculation with no error shown.
4. **Given** a route is active, **When** the user views the ETA, **Then** the traffic-adjusted ETA is clearly distinguished from (or replaces) the free-flow ETA so the user understands which estimate they are seeing.

---

### User Story 3 — Dynamic ETA Updates During Navigation (Priority: P3)

A user mid-navigation sees their ETA update dynamically as traffic conditions change ahead of them on their remaining route. On every traffic data refresh cycle, the system recalculates the ETA for the remaining route segments using the latest traffic data. The user sees the ETA display update without needing to take any action.

**Why this priority**: Builds on P2 by keeping the ETA accurate throughout the trip. A one-time ETA is useful at route start, but real-time updates during navigation complete the experience.

**Independent Test**: Can be tested by starting navigation on a route, simulating a traffic data refresh with changed congestion on upcoming segments, and verifying the displayed ETA changes accordingly.

**Acceptance Scenarios**:

1. **Given** the user is mid-navigation with an active route, **When** traffic data refreshes with changed conditions on ahead segments, **Then** the displayed ETA recalculates and updates automatically.
2. **Given** the user is mid-navigation, **When** a traffic refresh cycle occurs but no conditions have changed, **Then** the ETA remains stable (no flickering or unnecessary re-renders).
3. **Given** the user is mid-navigation, **When** traffic data becomes temporarily unavailable during a refresh, **Then** the previously displayed ETA remains shown and falls back to free-flow for future calculations until traffic data returns.

---

### User Story 4 — Multi-Source Traffic Data Aggregation (Priority: P4)

The system fetches traffic data from multiple external sources (TomTom Traffic Flow API and HERE Traffic Flow API) in parallel, normalizes both to a shared format, and merges them with existing P2P traffic probe data from the Waku network. When external sources overlap on the same road segment, the system produces a weighted average by confidence. This gives users the most accurate and comprehensive traffic picture available.

**Why this priority**: The quality of all traffic features depends on data richness. Multi-source aggregation improves accuracy and coverage, but the overlay and ETA features work with even a single data source, making this an enhancement rather than a prerequisite.

**Independent Test**: Can be tested by calling the aggregation logic with mock TomTom, HERE, and P2P probe data that overlap on the same segments and verifying the merged output uses confidence-weighted averaging.

**Acceptance Scenarios**:

1. **Given** both TomTom and HERE APIs return traffic data for the visible area, **When** the data is processed, **Then** both sources are normalized to a shared traffic segment format and merged.
2. **Given** both sources report data for the same road segment, **When** merging, **Then** the system produces a confidence-weighted average speed for that segment.
3. **Given** one external API is unavailable, **When** fetching, **Then** the system uses the other external source combined with P2P probe data without error.
4. **Given** both external APIs are unavailable, **When** fetching, **Then** the system falls back to P2P probe data only and the map/ETA features continue to function.

---

### Edge Cases

- What happens when a route segment is very short (< 10 meters) and has no direct traffic match? The system falls back to free-flow speed for that segment.
- What happens when the user is in an area with no road coverage from any traffic source? The map renders normally without traffic colors; ETA uses free-flow speeds.
- What happens when the user rapidly pans across the map? Traffic data fetching is debounced so the system does not flood external APIs with requests.
- What happens when a traffic data refresh returns stale data (older than the previous refresh)? The system keeps the more recent data and discards the stale response.
- What happens when a route has thousands of segments? The ETA calculation runs efficiently as a single pass over the segment array without blocking the UI thread.
- What happens when the user toggles traffic overlay off? Traffic colors and the legend disappear; ETA reverts to free-flow calculation.
- What happens when the map is zoomed out to a very large area? The system limits the density of traffic API sampling points to avoid excessive API calls and rendering overhead.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: System MUST display road segments on the map color-coded by congestion level: green (free-flow), yellow (slow), orange (congested), red (stopped).
- **FR-002**: System MUST update traffic coloring when the user pans or zooms the map to a new area.
- **FR-003**: System MUST display a persistent legend on the map explaining the four traffic color levels.
- **FR-004**: System MUST fetch traffic data from TomTom Traffic Flow API by sampling a grid of points within the visible bounding box.
- **FR-005**: System MUST fetch traffic data from HERE Traffic Flow API using a bounding-box query covering the visible viewport and, when a route is active, the full route bounding box.
- **FR-006**: System MUST fetch both external traffic sources in parallel to minimize latency.
- **FR-007**: System MUST normalize both external API responses to a shared TrafficSegment schema containing at minimum: segment coordinates, current speed, free-flow speed, and a confidence value.
- **FR-008**: System MUST merge overlapping segments from multiple sources using confidence-weighted averaging of speeds.
- **FR-009**: System MUST combine external API traffic data with existing P2P probe data from the Waku network.
- **FR-010**: System MUST compute a traffic-adjusted ETA for an active route by iterating over each road segment in the route geometry, looking up the current congestion for that segment, and computing travel time using current speed.
- **FR-011**: System MUST expose a pure function `calculateTrafficETA(routeSegments, trafficSegments)` that is independently testable with no side effects.
- **FR-012**: System MUST match route segments to traffic segments by coordinate proximity (spatial overlap).
- **FR-013**: System MUST fall back to free-flow speed for any route segment that has no matching traffic data.
- **FR-014**: System MUST display the traffic-adjusted ETA clearly distinguished from (or in place of) the free-flow ETA.
- **FR-015**: System MUST recalculate the traffic-adjusted ETA automatically on every traffic data refresh cycle.
- **FR-016**: System MUST fail silently if both external traffic APIs are unavailable — the map renders normally and ETA falls back to free-flow calculation with no error shown to the user.
- **FR-017**: System MUST format the ETA for display as minutes (for short trips) or hours + minutes (for longer trips).
- **FR-018**: System MUST debounce traffic data fetching when the user rapidly pans or zooms the map.
- **FR-019**: System MUST store external API keys securely and never expose them in client-side code beyond environment variable access.

### Key Entities

- **TrafficSegment (Normalized)**: A unified representation of a traffic-observed road segment from any data source. Contains: segment coordinates (start/end lat/lng or polyline), current speed (km/h), free-flow speed (km/h), congestion ratio (current/free-flow), confidence value (0.0–1.0), data source identifier, and timestamp.
- **RouteSegment (for ETA)**: A portion of a computed route with a distance (meters) and a reference to the underlying road's free-flow speed (km/h). Used as input to the ETA calculation function.
- **TrafficLegend**: A UI element mapping congestion level labels to their display colors. Derived from congestion thresholds applied to the congestion ratio.
- **CongestionRatio Thresholds**: The boundaries that map a congestion ratio (currentSpeed / freeFlowSpeed) to a color band: green (≥ 0.75), yellow (0.50–0.74), orange (0.25–0.49), red (< 0.25).

## Assumptions

- The existing P2P traffic probe system (Waku-based `probeCollector`, `trafficAggregator`, `trafficStore`) continues to function and its data is available for merging with external API data.
- The existing `TrafficOverlay` component is a placeholder and will be replaced/extended by this feature.
- The TomTom and HERE APIs require API keys provisioned by the user/developer and stored in `.env`.
- Traffic data refresh frequency follows the existing viewport-change debounce pattern (~500ms) augmented by a periodic timer (e.g., every 60 seconds for active routes).
- The congestion ratio thresholds (green ≥ 0.75, yellow 0.50–0.74, orange 0.25–0.49, red < 0.25) represent reasonable defaults matching industry conventions.
- Route geometry from Valhalla provides sufficient coordinate precision to spatially match against traffic segments.
- The `calculateTrafficETA` function receives pre-computed route segments and pre-fetched traffic segments — it does not perform any I/O.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Users can identify congested roads on the map within 2 seconds of it becoming visible, via color-coded road segments.
- **SC-002**: Traffic-adjusted ETA for a route deviates by no more than 15% from actual travel time under typical conditions (measured across a sample of 50+ trips).
- **SC-003**: 90% of users who view a route see a traffic-adjusted ETA rather than a free-flow-only ETA (when any traffic data is available).
- **SC-004**: ETA recalculates within 5 seconds of a traffic data refresh completing during active navigation.
- **SC-005**: The traffic overlay and ETA features introduce no user-visible errors or crashes when external traffic APIs are unavailable.
- **SC-006**: Traffic color updates are visible within 3 seconds of the user finishing a pan or zoom gesture.
- **SC-007**: The ETA calculation function produces correct results for 100% of unit test cases covering: full traffic coverage, partial coverage, no coverage, and mixed-source data.
