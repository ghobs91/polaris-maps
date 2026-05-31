## ADDED Requirements

### Requirement: BART API endpoint registration

The system SHALL register a BART (San Francisco Bay Area Rapid Transit) endpoint in `OTP_ENDPOINTS` with the following configuration:

- `label`: "BART San Francisco Bay Area"
- `bbox`: `[37.4, -122.6, 38.1, -121.7]`
- `apiStyle`: `"bart-v1"`
- `url`: https://api.bart.gov
- The endpoint SHALL be ordered before any GTFS-based US endpoints in the registry.

#### Scenario: BART endpoint matched for SF coordinates

- **WHEN** `findEndpointForCoords` is called with lat=37.77, lon=-122.42
- **THEN** it SHALL return the BART endpoint

#### Scenario: BART endpoint not matched for LA coordinates

- **WHEN** `findEndpointForCoords` is called with lat=34.05, lon=-118.24
- **THEN** it SHALL NOT return the BART endpoint

### Requirement: BART route line fetching

The system SHALL include a `fetchBartLines()` function in a new `bartFetcher.ts` module that:

- Fetches all BART lines (Red, Orange, Yellow, Green, Blue) via the BART API `route.aspx?cmd=routes` and `route.aspx?cmd=routeinfo`
- Returns `TransitRouteLine[]` with polyline geometry, stop lists, colors, and mode `"SUBWAY"`
- Caches results permanently (same pattern as `mbtaFetcher.ts`)

#### Scenario: BART fetcher returns all lines

- **WHEN** `fetchBartLines()` is called
- **THEN** the system SHALL return at least 5 `TransitRouteLine` entries (one per BART line)
- **THEN** each line SHALL have non-empty `geometry` and `stops`

#### Scenario: BART fetcher handles API errors gracefully

- **WHEN** the BART API returns a non-2xx response
- **THEN** `fetchBartLines()` SHALL return an empty array

### Requirement: BART dispatch in tryFetchViaOtp

The `tryFetchViaOtp` function SHALL dispatch `apiStyle: "bart-v1"` to `fetchBartLines()`.

#### Scenario: BART style triggers BART fetcher

- **WHEN** `tryFetchViaOtp` encounters an endpoint with `apiStyle === 'bart-v1'`
- **THEN** it SHALL call `fetchBartLines()`
- **THEN** non-empty results SHALL prevent falling through to Overpass
