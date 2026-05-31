## ADDED Requirements

### Requirement: Transit lines rendered via MapLibre vector tiles

The system SHALL render Transitous transit lines using a MapLibre vector tile source at the Transitous tile endpoint, rather than fetching geometry via API and building GeoJSON on the JS thread.

#### Scenario: Vector tile source added to map

- **WHEN** the transit layer is toggled on
- **THEN** a `MapLibreGL.VectorSource` SHALL be added sourcing from the Transitous tile URL
- **THEN** transit lines SHALL render without any JS processing of route geometry

#### Scenario: Tile URL is configurable

- **WHEN** `EXPO_PUBLIC_TRANSITOUS_BASE_URL` is set to `https://staging.api.transitous.org`
- **THEN** the tile URL SHALL derive from the configured base URL

#### Scenario: Existing JS lines coexist with tile source

- **WHEN** city-specific endpoints (NYC, Boston, etc.) return `TransitRouteLine[]` via JS fetchers AND Transitous tiles are active
- **THEN** both the JS-built GeoJSON lines and the vector tile lines SHALL render
- **THEN** no visual conflicts SHALL occur (tile lines render underneath JS lines)

### Requirement: Tile layer visibility toggle

The Transitous tile layer SHALL respect the existing `transitLayerVisible` store flag. When the transit layer is toggled off, SHALL be hidden immediately (no tile fetching).

#### Scenario: Tiles hidden when transit layer toggled off

- **WHEN** the user toggles the transit layer off
- **THEN** the Transitous tile source SHALL be hidden (visibility: none)
- **THEN** no tile network requests SHALL be in flight

### Requirement: Fallback to existing line sources

If the Transitous tile endpoint is unavailable (returning HTTP errors), the system SHALL fall back to existing `TransitRouteLine[]` sources (city-specific endpoints and Overpass) for transit line rendering. The tile layer SHALL be silently skipped.

#### Scenario: Tile endpoint returns 503

- **WHEN** the Transitous tile endpoint returns a non-2xx response
- **THEN** the system SHALL log a warning
- **THEN** existing JS line sources SHALL continue to render normally
