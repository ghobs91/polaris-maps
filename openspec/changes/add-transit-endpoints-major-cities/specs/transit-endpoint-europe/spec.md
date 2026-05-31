## ADDED Requirements

### Requirement: London TfL endpoint registration

The system SHALL register a Transport for London endpoint in `OTP_ENDPOINTS` with:

- `label`: "TfL London"
- `bbox`: `[51.2, -0.6, 51.75, 0.3]`
- `apiStyle`: `"tfl-v1"`
- `url`: https://api.tfl.gov.uk

#### Scenario: TfL endpoint matched for London coordinates

- **WHEN** `findEndpointForCoords` is called with lat=51.5, lon=-0.12
- **THEN** it SHALL return the TfL endpoint

### Requirement: TfL route line fetching

The system SHALL include a `fetchTflLines()` function in a new `tflFetcher.ts` module that:

- Fetches all TfL rail lines (Tube, DLR, Overground, Elizabeth, Trams, TfL Rail) via the TfL Unified API `/Line/Mode/tube,dlr,overground,elizabeth-line,tram` endpoint
- For each line, fetches the route geometry via `/Line/{id}/Route/Sequence/outbound` and stops via `/Line/{id}/StopPoints`
- Returns `TransitRouteLine[]` with polyline geometry, stop lists, TfL-branded colors, and appropriate mode tags

#### Scenario: TfL fetcher returns all lines

- **WHEN** `fetchTflLines()` is called
- **THEN** at least 15 `TransitRouteLine` entries SHALL be returned
- **THEN** Tube lines SHALL have `mode: "SUBWAY"`
- **THEN** DLR and Tram lines SHALL have `mode: "TRAM"`
- **THEN** Overground and Elizabeth line SHALL have `mode: "RAIL"`

### Requirement: Paris IDFM endpoint registration

The system SHALL register an Ile-de-France Mobilites endpoint in `OTP_ENDPOINTS` with:

- `label`: "IDFM Paris Metro"
- `bbox`: `[48.7, 2.0, 49.0, 2.6]`
- `apiStyle`: `"idfm-gtfs-v1"`
- `url`: IDFM GTFS feed URL (via Transitland or MobilityData)

#### Scenario: Paris fetcher returns all metro lines

- **WHEN** GTFS data is fetched for the IDFM endpoint with `routeTypeFilter: [1]`
- **THEN** at least 14 `TransitRouteLine` entries SHALL be returned (Metro lines 1-14)
- **THEN** each line SHALL have `mode: "SUBWAY"`

### Requirement: Berlin VBB endpoint registration

The system SHALL register a Berlin VBB endpoint in `OTP_ENDPOINTS` with:

- `label`: "VBB Berlin"
- `bbox`: `[52.3, 13.0, 52.7, 13.8]`
- `apiStyle`: `"vbb-gtfs-v1"`
- `url`: VBB GTFS feed URL

#### Scenario: Berlin fetcher returns U-Bahn and S-Bahn lines

- **WHEN** GTFS data is fetched for the VBB endpoint with `routeTypeFilter: [1, 2]`
- **THEN** `TransitRouteLine` entries SHALL be returned for U-Bahn (`mode: "SUBWAY"`) and S-Bahn (`mode: "RAIL"`) lines
- **THEN** at least 15 entries SHALL be returned

### Requirement: Madrid CRTM endpoint registration

The system SHALL register a Madrid CRTM endpoint in `OTP_ENDPOINTS` with:

- `label`: "CRTM Madrid Metro"
- `bbox`: `[40.25, -3.9, 40.6, -3.4]`
- `apiStyle`: `"madrid-gtfs-v1"`
- `url`: CRTM GTFS feed URL

#### Scenario: Madrid fetcher returns metro lines

- **WHEN** GTFS data is fetched for the Madrid endpoint with `routeTypeFilter: [1]`
- **THEN** at least 12 `TransitRouteLine` entries SHALL be returned
- **THEN** each line SHALL have `mode: "SUBWAY"`

### Requirement: European dispatch in tryFetchViaOtp

Each European endpoint's `apiStyle` SHALL be dispatched to its respective fetcher in `tryFetchViaOtp`:

- `"tfl-v1"` → `fetchTflLines()`
- `"idfm-gtfs-v1"` → `fetchGtfsStaticLines(IDFM_CONFIG)`
- `"vbb-gtfs-v1"` → `fetchGtfsStaticLines(VBB_CONFIG)`
- `"madrid-gtfs-v1"` → `fetchGtfsStaticLines(CRTM_CONFIG)`

#### Scenario: European styles trigger correct fetchers

- **WHEN** `tryFetchViaOtp` encounters any of the European `apiStyle` values
- **THEN** it SHALL dispatch to the corresponding fetcher function
- **THEN** non-empty results SHALL prevent falling through to Overpass
