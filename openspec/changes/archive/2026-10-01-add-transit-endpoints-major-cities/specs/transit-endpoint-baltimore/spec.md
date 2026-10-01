## ADDED Requirements

### Requirement: Baltimore endpoint registration

The system SHALL register a Baltimore Metro + PATCO endpoint in `OTP_ENDPOINTS` with:

- `label`: "Baltimore Metro & PATCO"
- `bbox`: `[39.15, -76.8, 39.45, -76.4]`
- `apiStyle`: `"baltimore-gtfs-v1"`
- `url`: MTA Maryland rail GTFS feed URL
- `routeTypeFilter`: `[0, 1]` (light_rail + subway for Metro SubwayLink + Light Rail + PATCO)

#### Scenario: Baltimore fetcher returns multiple lines

- **WHEN** GTFS data is fetched for the Baltimore endpoint
- **THEN** at least 2 `TransitRouteLine` entries SHALL be returned (Metro SubwayLink and Light Rail)
- **THEN** the SubwayLink SHALL have `mode: "SUBWAY"` and Light Rail SHALL have `mode: "TRAM"`
