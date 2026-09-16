## ADDED Requirements

### Requirement: Staged result emission

The system SHALL emit scored, deduplicated search results after each source stage completes, in the order: local database, offline cities, Photon, category search, remaining network sources. A later stage SHALL NOT remove results already emitted unless they are duplicates of a newly merged result, and the final emission SHALL be marked as complete.

#### Scenario: Local results emitted before network sources complete

- **WHEN** a search starts and the local database stage returns results
- **THEN** the system SHALL emit those results immediately via the staged callback
- **AND** the emission SHALL be scored and ranked, not raw rows

#### Scenario: Slow source does not block faster stages

- **WHEN** Photon resolves before Overpass and Overture
- **THEN** the Photon-stage emission SHALL occur without waiting for the slower sources
- **AND** the final emission SHALL occur only after all network sources settle or time out

#### Scenario: Duplicate merged across stages

- **WHEN** a result emitted in the local stage is also returned by Photon
- **THEN** the merged result SHALL appear exactly once in subsequent emissions

### Requirement: Source gating on local sufficiency

The system SHALL skip named network sources when the local and offline-city stages already produce a sufficient number of strong text matches for the query class. Gate thresholds SHALL be defined as named constants in a single module.

#### Scenario: Sufficient local category matches skip Overpass

- **WHEN** a category query yields at least the configured sufficient-local threshold of strong matches
- **THEN** the system SHALL NOT issue the Overpass category request for that search

#### Scenario: Sparse local results run all sources

- **WHEN** a query yields fewer strong local matches than the configured threshold
- **THEN** the system SHALL run all applicable network sources

#### Scenario: Exact structured local address skips Nominatim

- **WHEN** an address query has an exact house-number and street match in the local geocoding database
- **THEN** the system SHALL NOT issue a Nominatim request for that search

### Requirement: Offline city results in the fast phase

The system SHALL query the GeoNames cities database, when available, during the local/cities stage and SHALL rank city results by text relevance, population, and proximity to the reference point.

#### Scenario: City query resolves offline

- **WHEN** the GeoNames database is downloaded and the user searches a city name while offline
- **THEN** the city SHALL appear in the cities-stage emission before any network source resolves

#### Scenario: GeoNames database unavailable

- **WHEN** the GeoNames database has not been downloaded or the configured URL is a placeholder
- **THEN** the search SHALL complete without error and without city-stage results
- **AND** the database download SHALL be retried opportunistically on a later session

### Requirement: Shared consumer search behavior

The system SHALL provide one shared search-session implementation that owns debounce, abort-on-new-input, local-first emission, and staged updates. All in-app search consumers (search tab, floating search panel including stop search, destination panel, CarPlay) SHALL use this implementation or its non-React equivalent.

#### Scenario: New keystroke aborts in-flight network work

- **WHEN** a user types while a previous search is still running
- **THEN** the previous search's abort signal SHALL be triggered
- **AND** no results from the superseded search SHALL be applied to the UI

#### Scenario: Stop-search path is debounced and abortable

- **WHEN** the user types in the add-stop search field
- **THEN** network search SHALL be debounced and superseded requests SHALL be aborted
- **AND** local results SHALL still render immediately

### Requirement: Nominatim request policy compliance

The system SHALL enforce a shared minimum 1,000 ms interval between Nominatim requests across all call sites, including category fallback searches, and SHALL make the throttle abort-aware.

#### Scenario: Category fallback respects throttle

- **WHEN** the category search falls back to Nominatim within 1,000 ms of a previous Nominatim request
- **THEN** the request SHALL wait until the interval elapses
- **AND** the wait SHALL abort immediately if the search is superseded

### Requirement: Network sources time-bounded

Every network search source SHALL have an explicit timeout no greater than 8 seconds, and a timed-out source SHALL be treated as returning no results without failing the overall search.

#### Scenario: Overpass timeout degrades gracefully

- **WHEN** the Overpass request exceeds its configured timeout
- **THEN** the search SHALL continue with results from other sources
- **AND** the final emission SHALL still occur
