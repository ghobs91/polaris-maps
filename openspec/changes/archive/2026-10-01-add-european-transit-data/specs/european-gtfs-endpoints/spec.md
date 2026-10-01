## ADDED Requirements

### Requirement: European country GTFS feeds are registered in the endpoint registry

The system SHALL register 10 European country-level GTFS feed entries as `OtpEndpoint` objects in the `OTP_ENDPOINTS` array, each with a unique `apiStyle`, a national bounding box, and a GTFS download URL from `data.public-transport.earth`.

#### Scenario: Germany GTFS endpoint is registered

- **WHEN** the endpoint registry is loaded at runtime
- **THEN** an entry with `apiStyle: 'de-gtfs-v1'`, label `'Deutschland GTFS'`, and URL `'https://data.public-transport.earth/gtfs/de'` exists in `OTP_ENDPOINTS`
- **AND** its bbox covers German territory (`[47.2, 5.8, 55.1, 15.1]`)

#### Scenario: Denmark GTFS endpoint is registered

- **WHEN** the endpoint registry is loaded at runtime
- **THEN** an entry with `apiStyle: 'dk-gtfs-v1'`, label `'Denmark GTFS'`, and URL `'https://data.public-transport.earth/gtfs/dk'` exists in `OTP_ENDPOINTS`
- **AND** its bbox covers Danish territory including islands (`[54.5, 7.5, 57.8, 15.5]`)

#### Scenario: Finland GTFS endpoint is registered

- **WHEN** the endpoint registry is loaded at runtime
- **THEN** an entry with `apiStyle: 'fi-gtfs-v1'`, label `'Finland GTFS'`, and URL `'https://data.public-transport.earth/gtfs/fi'` exists in `OTP_ENDPOINTS`

#### Scenario: Estonia GTFS endpoint is registered

- **WHEN** the endpoint registry is loaded at runtime
- **THEN** an entry with `apiStyle: 'ee-gtfs-v1'`, label `'Estonia GTFS'`, and URL `'https://data.public-transport.earth/gtfs/ee'` exists in `OTP_ENDPOINTS`

#### Scenario: Ireland GTFS endpoint is registered

- **WHEN** the endpoint registry is loaded at runtime
- **THEN** an entry with `apiStyle: 'ie-gtfs-v1'`, label `'Ireland GTFS'`, and URL `'https://data.public-transport.earth/gtfs/ie'` exists in `OTP_ENDPOINTS`

#### Scenario: Luxembourg GTFS endpoint is registered

- **WHEN** the endpoint registry is loaded at runtime
- **THEN** an entry with `apiStyle: 'lu-gtfs-v1'`, label `'Luxembourg GTFS'`, and URL `'https://data.public-transport.earth/gtfs/lu'` exists in `OTP_ENDPOINTS`

#### Scenario: Netherlands GTFS endpoint is registered

- **WHEN** the endpoint registry is loaded at runtime
- **THEN** an entry with `apiStyle: 'nl-gtfs-v1'`, label `'Netherlands GTFS'`, and URL `'https://data.public-transport.earth/gtfs/nl'` exists in `OTP_ENDPOINTS`

#### Scenario: Norway GTFS endpoint is registered

- **WHEN** the endpoint registry is loaded at runtime
- **THEN** an entry with `apiStyle: 'no-gtfs-v1'`, label `'Norway GTFS'`, and URL `'https://data.public-transport.earth/gtfs/no'` exists in `OTP_ENDPOINTS`

#### Scenario: Sweden GTFS endpoint is registered

- **WHEN** the endpoint registry is loaded at runtime
- **THEN** an entry with `apiStyle: 'se-gtfs-v1'`, label `'Sweden GTFS'`, and URL `'https://data.public-transport.earth/gtfs/se'` exists in `OTP_ENDPOINTS`

#### Scenario: Switzerland GTFS endpoint is registered

- **WHEN** the endpoint registry is loaded at runtime
- **THEN** an entry with `apiStyle: 'ch-gtfs-v1'`, label `'Switzerland GTFS'`, and URL `'https://data.public-transport.earth/gtfs/ch'` exists in `OTP_ENDPOINTS`

### Requirement: Country endpoints are ordered after city-specific European endpoints

The SHALL place the 10 country entries in `OTP_ENDPOINTS` after existing European city-specific endpoints (TfL London, IDFM Paris, VBB Berlin, CRTM Madrid) but before the Entur Norway entry, so that `findEndpointForCoords` returns city-specific endpoints first when the viewport center falls within a city bbox.

#### Scenario: Berlin viewport returns VBB, not Germany

- **WHEN** the viewport center is at `(52.5, 13.4)` (central Berlin)
- **AND** `findEndpointForCoords` is called
- **THEN** the returned endpoint has `apiStyle: 'vbb-gtfs-v1'` (not `de-gtfs-v1`)

#### Scenario: Hamburg viewport returns Germany

- **WHEN** the viewport center is at `(53.55, 10.0)` (Hamburg, not covered by any city endpoint)
- **AND** `findEndpointForCoords` is called
- **THEN** the returned endpoint has `apiStyle: 'de-gtfs-v1'`

#### Scenario: Copenhagen viewport returns Denmark

- **WHEN** the viewport center is at `(55.67, 12.57)` (Copenhagen, no city endpoint)
- **AND** `findEndpointForCoords` is called
- **THEN** the returned endpoint has `apiStyle: 'dk-gtfs-v1'`

### Requirement: Each country endpoint has a GTFS fetcher config

Each country's `apiStyle` SHALL have a corresponding entry in `GTFS_CONFIGS` with `filterByRouteType: false` (all transit modes included) and an appropriate download timeout based on the country's GTFS feed size.

#### Scenario: Denmark GTFS config includes all modes

- **WHEN** `GTFS_CONFIGS['dk-gtfs-v1']` is accessed
- **THEN** the config has `filterByRouteType: false`
- **AND** the config has `timeoutMs: 60000`

#### Scenario: Germany GTFS config has longer timeout

- **WHEN** `GTFS_CONFIGS['de-gtfs-v1']` is accessed
- **THEN** the config has `timeoutMs: 90000` (large feed)

#### Scenario: Luxembourg GTFS config has shorter timeout

- **WHEN** `GTFS_CONFIGS['lu-gtfs-v1']` is accessed
- **THEN** the config has `timeoutMs: 45000` (small feed)

### Requirement: New apiStyle values are added to the OtpApiStyle union type

The system SHALL extend the `OtpApiStyle` union type with 10 new literal string values: `'de-gtfs-v1'`, `'dk-gtfs-v1'`, `'fi-gtfs-v1'`, `'ee-gtfs-v1'`, `'ie-gtfs-v1'`, `'lu-gtfs-v1'`, `'nl-gtfs-v1'`, `'no-gtfs-v1'`, `'se-gtfs-v1'`, `'ch-gtfs-v1'`.

#### Scenario: Union type accepts new apiStyle values

- **WHEN** a variable is typed as `OtpApiStyle`
- **THEN** the value `'dk-gtfs-v1'` compiles without error
- **AND** the value `'de-gtfs-v1'` compiles without error

### Requirement: Transit dispatch chain handles country GTFS endpoints

The `tryFetchViaOtp` function in `transitLineFetcher.ts` SHALL handle the 10 new apiStyle values by dispatching to `fetchGtfsStaticLines` with the endpoint URL and country-specific GTFS config, using the existing `GTFS_CONFIGS[ep.apiStyle]` lookup with no dispatch code changes.

#### Scenario: Denmark endpoint dispatches correctly

- **WHEN** `tryFetchViaOtp` receives a viewport matching Denmark's bbox
- **AND** the endpoint has `apiStyle: 'dk-gtfs-v1'`
- **THEN** `GTFS_CONFIGS['dk-gtfs-v1']` returns a valid config
- **AND** `fetchGtfsStaticLines` is called with `feedUrl: 'https://data.public-transport.earth/gtfs/dk'`

#### Scenario: Failed GTFS download falls through to Overpass

- **WHEN** a country GTFS feed download fails (network error or 404)
- **THEN** `fetchGtfsStaticLines` returns an empty array
- **AND** the dispatch logic marks the OTP result as empty
- **AND** `fetchTransitLines` falls through to the Overpass API fallback
