## ADDED Requirements

### Requirement: GTFS download and parse pipeline

The system SHALL download DOT-listed GTFS `.zip` feeds, extract the relevant text files, and parse them into the shared `GtfsFeedData` shape, handling 404/500 responses, malformed archives, missing shapes/routes, and duplicate route IDs without throwing.

#### Scenario: Successful download and parse

- **WHEN** a valid GTFS feed URL is fetched
- **THEN** the archive SHALL be parsed into routes, trips, shapes, stops, and stop times
- **THEN** the result SHALL be cached in memory (and persisted for offline use)

#### Scenario: Feed download fails

- **WHEN** the feed URL returns a non-2xx response or the archive is malformed
- **THEN** the pipeline SHALL return no lines and log a warning
- **THEN** it SHALL NOT throw into the caller
