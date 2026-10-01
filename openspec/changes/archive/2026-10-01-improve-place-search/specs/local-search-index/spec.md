## ADDED Requirements

### Requirement: Incremental full-text index maintenance

The system SHALL update the full-text search index only for rows written during an Overture places upsert. A full index `rebuild` SHALL NOT run on the search path, and SHALL be reserved for migrations, region import, and recovery.

#### Scenario: Search-triggered upsert is incremental

- **WHEN** an Overture fetch upserts 200 places during a search
- **THEN** the full-text index SHALL be updated for exactly those rows within the same transaction
- **AND** the total time spent on full-text index maintenance SHALL be proportional to the number of upserted rows, not the size of the places table

#### Scenario: Newly upserted places are immediately searchable

- **WHEN** an Overture upsert completes
- **THEN** a full-text search for a name among the upserted places SHALL return those places

#### Scenario: Index consistency check with recovery

- **WHEN** the places row count and full-text index row count differ after maintenance
- **THEN** the system SHALL rebuild the full-text index once and continue

### Requirement: Weighted full-text relevance

The system SHALL rank full-text matches using bm25 column weights that prefer name matches over brand, category, and city matches, and SHALL expose a normalized full-text relevance signal to the unified ranker.

#### Scenario: Name match outranks city match

- **WHEN** two places match the same query token, one in its name and one only in its city
- **THEN** the name match SHALL rank higher

#### Scenario: Full-text signal contributes to unified score

- **WHEN** a result comes from the local full-text source
- **THEN** its normalized bm25 relevance SHALL be incorporated into the unified text score

### Requirement: Prefix index for autocomplete

The places full-text index SHALL include prefix indexes for token lengths 2 through 4 so that prefix queries used during typing do not fall back to full scans.

#### Scenario: Short prefix query is index-accelerated

- **WHEN** the user types a two-character prefix
- **THEN** the query SHALL use the prefix index
- **AND** the system SHALL NOT perform a `LIKE '%...%'` scan over all places

### Requirement: Structured address querying with spatial ranking

The system SHALL classify address query tokens into house number, street, city, state, and postcode when confidence is sufficient, SHALL query local geocoding entries using those structured fields, and SHALL rank matches by distance from the reference point. When classification confidence is low, the system SHALL fall back to the existing free-text behavior.

#### Scenario: Structured address ranks nearby match first

- **WHEN** the user searches an address whose house number and street exist in multiple imported regions
- **THEN** the local result nearest the reference point SHALL rank first

#### Scenario: Structured parse miss falls back

- **WHEN** the structured query returns no results
- **THEN** the system SHALL fall back to the free-text full-text query

### Requirement: Local typo tolerance for geocoding

The system SHALL provide an offline typo-tolerant lookup for street and locality names using a trigram-indexed geocoding table, consulted when primary full-text matching yields insufficient results.

#### Scenario: Misspelled street found offline

- **WHEN** the user searches a street name with one transposed or substituted character
- **AND** the primary full-text query returns no matches
- **THEN** the trigram lookup SHALL return the intended street when it exists in imported regions

#### Scenario: Trigram fallback does not replace exact matches

- **WHEN** the primary full-text query returns matches
- **THEN** trigram results SHALL be merged only as lower-ranked additions, never replacing primary matches
