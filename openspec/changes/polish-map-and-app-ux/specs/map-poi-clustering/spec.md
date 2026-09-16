## ADDED Requirements

### Requirement: Low-zoom POI clustering

The system SHALL aggregate nearby POIs into cluster markers when the map zoom is below the individual-marker threshold, replacing the current behavior of hiding POIs below zoom 14. Each cluster marker SHALL display the number of POIs it contains.

#### Scenario: Clusters appear when zoomed out

- **WHEN** the map is below the individual-marker threshold and POIs are available for the viewport
- **THEN** each group of nearby POIs is rendered as a single cluster marker whose label is the count of contained POIs
- **AND** individual POI markers are not rendered for those POIs

#### Scenario: Individual markers resume at high zoom

- **WHEN** the map reaches or exceeds the individual-marker threshold
- **THEN** clusters are replaced by individual POI markers and their labels

### Requirement: Cluster tap expands the cluster

Tapping a cluster marker SHALL zoom and center the map so the cluster expands into its constituent POIs or finer clusters.

#### Scenario: Tap a cluster marker

- **WHEN** the user taps a cluster marker containing multiple POIs
- **THEN** the camera animates to the cluster's expansion zoom and the contained POIs are shown as individual markers or smaller clusters

#### Scenario: Cluster of a single location

- **WHEN** the user taps a cluster whose contained POIs cannot be separated further at any supported zoom
- **THEN** the system shows the POIs as individual markers and focuses the first one

### Requirement: Cluster count reflects contained POIs

The number shown on a cluster marker SHALL equal the number of POIs the system has assigned to that cluster for the current viewport and zoom.

#### Scenario: Count updates with the viewport

- **WHEN** the user zooms in or pans so that the set of POIs assigned to a cluster changes
- **THEN** the cluster marker's count updates to the new number of contained POIs after the region settles

### Requirement: Collision-safe clusters and labels

Cluster badges SHALL use a single-line count that remains legible, and the existing pixel-exclusion filtering for individual POI labels SHALL be preserved so that labels do not overlap.

#### Scenario: Dense cluster area

- **WHEN** the viewport contains more POIs than can fit as individual markers
- **THEN** overlapping POIs are represented by clusters and the individually rendered labels do not overlap

### Requirement: Clustering preserves map frame rate

Clustering MUST NOT run on the UI thread during pan, zoom, or rotate gestures. The system SHALL recompute clusters only after the region settles, SHALL memoize results for an unchanged viewport, and SHALL bound the number of rendered markers so map tile rendering stays at 60fps (Constitution IV).

#### Scenario: No jank while panning or pinching

- **WHEN** the user pans or pinches at any zoom level
- **THEN** cluster recomputation is deferred until the gesture settles and the map animation frame rate does not drop below 60fps on target devices

#### Scenario: Unchanged viewport does not recompute

- **WHEN** the viewport, zoom, and POI set are unchanged
- **THEN** cluster results are reused from the memoized value without recomputation

### Requirement: Clustering works offline

When the device is offline, clustering SHALL be computed from locally cached POIs (the Overture SQLite cache and downloaded region packs) and MUST NOT require a network request.

#### Scenario: Offline cluster from cache

- **WHEN** the device is offline and the viewport contains cached POIs
- **THEN** clusters render from the cache with accurate counts and no network fetch is attempted

### Requirement: Bounded low-zoom POI fetch tier

The system SHALL serve low-zoom clustering from cached places first and SHALL cap any online low-zoom fetch, and it MUST NOT issue expensive full Overpass queries below the individual-marker threshold.

#### Scenario: Low-zoom viewport fetch

- **WHEN** the user views an area below the individual-marker threshold
- **THEN** cached places are used immediately and any online fetch is bounded by an explicit per-zoom cap
