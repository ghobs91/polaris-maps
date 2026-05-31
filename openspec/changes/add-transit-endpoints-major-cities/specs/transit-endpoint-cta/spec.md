## ADDED Requirements

### Requirement: CTA endpoint registration

The system SHALL register a Chicago Transit Authority endpoint in `OTP_ENDPOINTS` with:

- `label`: "CTA Chicago L"
- `bbox`: `[41.6, -88.0, 42.1, -87.5]`
- `apiStyle`: `"cta-gtfs-v1"`
- `url`: GTFS feed URL for CTA rail (Transitland or agency CDN)

#### Scenario: CTA endpoint matched for Chicago coordinates

- **WHEN** `findEndpointForCoords` is called with lat=41.88, lon=-87.63
- **THEN** it SHALL return the CTA endpoint

### Requirement: CTA route lines via GTFS Static

The system SHALL fetch CTA "L" route lines (Red, Blue, Green, Brown, Orange, Pink, Purple, Yellow) via the shared GTFS Static fetcher with CTA-specific configuration:

- `routeTypeFilter`: `[1]` (subway/metro only)
- `agencyNameMap`: map "Chicago Transit Authority" to "CTA"

#### Scenario: CTA fetcher returns 8 lines

- **WHEN** GTFS data is fetched and parsed for the CTA endpoint
- **THEN** at least 8 `TransitRouteLine` entries SHALL be returned (one per CTA "L" line)
- **THEN** each line SHALL have `mode: "SUBWAY"`
- **THEN** each line SHALL have non-empty `geometry` and `stops`

#### Scenario: GTFS download failure

- **WHEN** the GTFS feed URL is unreachable
- **THEN** the system SHALL return an empty array (not throw)
