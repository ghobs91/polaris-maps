## ADDED Requirements

### Requirement: Query result cache

The system SHALL cache merged network-augmented search results in a bounded in-memory LRU keyed by normalized query text, quantized viewport bounds, reference point, and result-affecting options. Cache hits SHALL return without issuing any network request.

#### Scenario: Repeated identical search hits cache

- **WHEN** the user runs the same query twice with the same viewport and options within the cache TTL
- **THEN** the second search SHALL return cached results without calling Photon, Overpass, Nominatim, or Overture

#### Scenario: Local phase is never served from cache

- **WHEN** a query has been cached
- **THEN** the local database stage SHALL still query the database on every search

#### Scenario: Cache is bounded

- **WHEN** the number of cached entries exceeds the configured maximum
- **THEN** the least-recently-used entries SHALL be evicted

### Requirement: In-flight request deduplication

The system SHALL deduplicate concurrent identical searches so that only one execution of the underlying sources runs per cache key.

#### Scenario: Two consumers search simultaneously

- **WHEN** the search tab and the map panel run the same query concurrently
- **THEN** the network sources SHALL execute once
- **AND** both callers SHALL receive the same results

### Requirement: Negative result caching

The system SHALL cache empty network results for a shorter TTL than non-empty results to avoid repeating slow fruitless queries.

#### Scenario: Empty result not re-queried immediately

- **WHEN** a query returns no results from network sources
- **AND** the same query is retried within the negative-cache window
- **THEN** the system SHALL NOT re-issue the network requests

### Requirement: Cache invalidation on data change

The system SHALL invalidate cached entries whose viewport overlaps data that has been updated by Overture upserts or region import/removal.

#### Scenario: New places invalidate overlapping cache entries

- **WHEN** `upsertOverturePlaces` writes places inside a cached entry's viewport
- **THEN** that cache entry SHALL be invalidated
- **AND** the next matching search SHALL re-query the sources

#### Scenario: TTL bounds staleness

- **WHEN** cached results are older than the configured TTL
- **THEN** they SHALL NOT be used regardless of invalidation state
