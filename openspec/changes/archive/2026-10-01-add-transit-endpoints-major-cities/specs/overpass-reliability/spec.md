## ADDED Requirements

### Requirement: Overpass POST method

The `overpassFetch` function SHALL send Overpass queries via HTTP POST with `Content-Type: application/x-www-form-urlencoded` instead of GET with query parameters, avoiding URL length limits for large queries.

#### Scenario: POST method used for Overpass requests

- **WHEN** `overpassFetch` is called with any query
- **THEN** the request SHALL use the HTTP POST method
- **THEN** the body SHALL contain `data=<url-encoded-query>`

### Requirement: Overpass query timeout

The Overpass server-side timeout SHALL be set to 60 seconds (`[timeout:60]`) for all tile fetch queries, giving the Overpass engine enough time to process dense metropolitan areas without truncating results.

#### Scenario: 60-second server timeout

- **WHEN** a tile query is constructed for Overpass
- **THEN** the query SHALL include `[timeout:60]`

### Requirement: Overpass client timeout

The client-side timeout for Overpass requests SHALL be 75 seconds (`75_000` ms), providing 15 seconds of headroom beyond the server timeout for mobile network latency.

#### Scenario: Client timeout exceeds server timeout

- **WHEN** `overpassFetch` is called with `timeoutMs`
- **THEN** the timeout SHALL be at least 75,000 ms (75 seconds)

### Requirement: Retry with backoff

Failed Overpass tile fetches SHALL be retried up to 3 times with exponential backoff (1s, 2s delays). After 3 failures, the tile fetch SHALL propagate the error to the caller, which logs it and leaves the tile unmarked so it can be retried on the next viewport update.

#### Scenario: Successful retry after first attempt fails

- **WHEN** an Overpass tile fetch fails on attempt 1
- **THEN** the system SHALL wait 1 second and retry
- **WHEN** the second attempt succeeds
- **THEN** the tile SHALL be marked as fetched with the successful result

#### Scenario: All retries exhausted

- **WHEN** an Overpass tile fetch fails on all 3 attempts
- **THEN** an error SHALL be logged to the console
- **THEN** the tile SHALL NOT be marked as fetched
- **THEN** the error SHALL propagate to the caller

### Requirement: Error logging

Failures at any level of the transit line fetching pipeline SHALL log a descriptive warning or error to the console, including the tile coordinates and attempt number for Overpass failures.

#### Scenario: Tile failure logged with context

- **WHEN** a tile fetch fails
- **THEN** an error SHALL be logged with the tile coordinates and attempt number

#### Scenario: Top-level fetch failure logged

- **WHEN** `fetchTransitLines` throws an exception
- **THEN** a descriptive error SHALL be logged via `console.error`
