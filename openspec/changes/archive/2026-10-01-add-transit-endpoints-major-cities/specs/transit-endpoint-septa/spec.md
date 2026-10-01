## ADDED Requirements

### Requirement: SEPTA endpoint registration

The system SHALL register a SEPTA Metro endpoint in `OTP_ENDPOINTS` with:

- `label`: "SEPTA Metro Philadelphia"
- `bbox`: `[39.8, -75.4, 40.2, -74.9]`
- `apiStyle`: `"septa-gtfs-v1"`
- `url`: SEPTA rail GTFS feed URL
- `routeTypeFilter`: `[0, 1]` (light_rail + subway for trolley lines + subway lines)

#### Scenario: SEPTA fetcher returns multiple lines

- **WHEN** GTFS data is fetched for the SEPTA endpoint
- **THEN** at least 3 `TransitRouteLine` entries SHALL be returned (Market-Frankford Line, Broad Street Line, Norristown High Speed Line, and trolley routes)
- **THEN** lines tagged as route_type=1 SHALL have `mode: "SUBWAY"`
- **THEN** lines tagged as route_type=0 SHALL have `mode: "TRAM"`
