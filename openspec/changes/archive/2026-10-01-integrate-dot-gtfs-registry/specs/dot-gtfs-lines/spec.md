## ADDED Requirements

### Requirement: GTFS data converted to transit lines

The system SHALL convert parsed GTFS routes, shapes, and stops into `TransitRouteLine[]`, mapping GTFS `route_type` values onto the app's `TransitMode` and including line geometry, colors, and stops.

#### Scenario: All modes mapped

- **WHEN** a feed contains bus, rail, subway, tram, and ferry routes
- **THEN** each route SHALL be converted to a `TransitRouteLine` with the correct `TransitMode`
- **THEN** the DOT GTFS config SHALL include all route types (no route-type filtering)

#### Scenario: Offline region GTFS

- **WHEN** an offline region is downloaded
- **THEN** the DOT GTFS feeds covering that region SHALL be cached and rendered offline without a network request
