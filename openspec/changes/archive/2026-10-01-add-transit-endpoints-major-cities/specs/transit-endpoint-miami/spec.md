## ADDED Requirements

### Requirement: Miami Metrorail endpoint registration

The system SHALL register a Miami-Dade Metrorail endpoint in `OTP_ENDPOINTS` with:

- `label`: "Miami-Dade Metrorail"
- `bbox`: `[25.6, -80.5, 25.9, -80.1]`
- `apiStyle`: `"miami-gtfs-v1"`
- `url`: Miami-Dade Transit rail GTFS feed URL
- `routeTypeFilter`: `[1]` (subway)

#### Scenario: Miami Metrorail fetcher returns at least one line

- **WHEN** GTFS data is fetched for the Miami endpoint
- **THEN** at least one `TransitRouteLine` SHALL be returned for the Metrorail line
- **THEN** the line SHALL have `mode: "SUBWAY"`
