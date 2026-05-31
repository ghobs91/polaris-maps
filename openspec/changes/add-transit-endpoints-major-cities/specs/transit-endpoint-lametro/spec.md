## ADDED Requirements

### Requirement: LA Metro endpoint registration

The system SHALL register an LA Metro Rail endpoint in `OTP_ENDPOINTS` with:

- `label`: "LA Metro Rail"
- `bbox`: `[33.7, -118.5, 34.2, -117.9]`
- `apiStyle`: `"lametro-gtfs-v1"`
- `url`: LA Metro rail GTFS feed URL
- `routeTypeFilter`: `[0, 1]` (light_rail + subway)

#### Scenario: LA Metro fetcher returns all lines

- **WHEN** GTFS data is fetched for the LA Metro endpoint
- **THEN** `TransitRouteLine` entries SHALL be returned for A, B, C, D, E, and K lines
- **THEN** subway lines (B/D) SHALL have `mode: "SUBWAY"`
- **THEN** light rail lines (A/C/E/K) SHALL have `mode: "TRAM"`
