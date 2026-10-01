## ADDED Requirements

### Requirement: MARTA endpoint registration

The system SHALL register a MARTA rail endpoint in `OTP_ENDPOINTS` with:

- `label`: "MARTA Rail Atlanta"
- `bbox`: `[33.6, -84.6, 33.9, -84.2]`
- `apiStyle`: `"marta-gtfs-v1"`
- `url`: MARTA rail GTFS feed URL
- `routeTypeFilter`: `[1]` (subway)

#### Scenario: MARTA fetcher returns all lines

- **WHEN** GTFS data is fetched for the MARTA endpoint
- **THEN** `TransitRouteLine` entries SHALL be returned for Red, Gold, Blue, and Green lines
- **THEN** each line SHALL have `mode: "SUBWAY"`
