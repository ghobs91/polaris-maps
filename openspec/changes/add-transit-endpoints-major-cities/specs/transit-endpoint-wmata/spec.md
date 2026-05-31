## ADDED Requirements

### Requirement: WMATA API endpoint registration

The system SHALL register a Washington Metro (WMATA) endpoint in `OTP_ENDPOINTS` with the following configuration:

- `label`: "WMATA Washington DC Metro"
- `bbox`: `[38.75, -77.5, 39.2, -76.8]`
- `apiStyle`: `"wmata-v1"`
- `url`: https://api.wmata.com
- The endpoint SHALL be ordered after TriMet and before Entur in the registry array, so it appears before any GTFS-based endpoints.

#### Scenario: WMATA endpoint matched for DC coordinates

- **WHEN** `findEndpointForCoords` is called with lat=38.9, lon=-77.0
- **THEN** it SHALL return the WMATA endpoint
- **THEN** no other endpoint SHALL be returned

#### Scenario: WMATA endpoint not matched for Chicago coordinates

- **WHEN** `findEndpointForCoords` is called with lat=41.88, lon=-87.63
- **THEN** it SHALL NOT return the WMATA endpoint

### Requirement: WMATA route line fetching

The system SHALL include a `fetchWmataLines()` function in a new `wmataFetcher.ts` module that:

- Fetches all WMATA rail lines (Red, Orange, Blue, Green, Yellow, Silver) via the WMATA RailStationPrediction and RailIncidents APIs
- Returns `TransitRouteLine[]` with polyline geometry, stop lists, colors, and mode tags
- Caches results permanently in a module-level variable (same pattern as `mbtaFetcher.ts`)
- Uses `EXPO_PUBLIC_WMATA_API_KEY` environment variable for authentication

#### Scenario: First call fetches from WMATA API

- **WHEN** `fetchWmataLines()` is called and no cached data exists
- **THEN** the system SHALL make HTTP requests to `https://api.wmata.com/Rail.svc/json/jLines` and `https://api.wmata.com/Rail.svc/json/jStations`
- **THEN** return `TransitRouteLine[]` with one entry per WMATA rail line

#### Scenario: Cached call returns instantly

- **WHEN** `fetchWmataLines()` has been called before within the same session
- **THEN** the system SHALL return the cached result without making network requests

#### Scenario: API failure returns empty

- **WHEN** the WMATA API returns a non-2xx response or times out
- **THEN** `fetchWmataLines()` SHALL return an empty array

### Requirement: WMATA dispatch in tryFetchViaOtp

The `tryFetchViaOtp` function in `transitLineFetcher.ts` SHALL dispatch `apiStyle: "wmata-v1"` to `fetchWmataLines()`.

#### Scenario: WMATA style triggers WMATA fetcher

- **WHEN** `tryFetchViaOtp` encounters an endpoint with `apiStyle === 'wmata-v1'`
- **THEN** it SHALL call `fetchWmataLines()`
- **THEN** if lines are non-empty, return them
- **THEN** if lines are empty, return null (fall through to Overpass)
