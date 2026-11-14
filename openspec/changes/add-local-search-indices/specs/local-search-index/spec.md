## ADDED Requirements

### Requirement: On-device POI search

The system SHALL answer viewport, category, tag, and name POI queries for a
covered area from the on-device index, without any network request.

#### Scenario: Covered viewport answers offline

- **WHEN** a downloaded region covers the requested bounding box
- **THEN** the query executes against `osm_pois` and returns without contacting a remote service

#### Scenario: Empty result is not a reason to go remote

- **WHEN** a covered bounding box contains no matching POIs
- **THEN** an empty result is returned and no fallback query is issued

#### Scenario: Uncovered area still falls back

- **WHEN** no region or shard set covers the bounding box
- **THEN** the caller may use the network fallback, and the app continues to work if it is unavailable

### Requirement: Coverage accounting

The system SHALL distinguish "no matches here" from "no data here", and SHALL
only permit a network fallback for the second case.

#### Scenario: Coverage is per region and per shard cell

- **WHEN** coverage rows exist for a region or for every shard intersecting the box
- **THEN** the box counts as covered

### Requirement: Index failures never degrade search

The system SHALL treat an unavailable or corrupt index as "uncovered" and fall
back to the previous behaviour.

#### Scenario: Missing table or schema race

- **WHEN** the index cannot be queried
- **THEN** the query path behaves exactly as it did before the index existed

### Requirement: On-device transit lookup

The system SHALL answer "which lines serve this stop?" and "which route relations
intersect this viewport?" from the transit index when the area is covered.

#### Scenario: Covered stop

- **WHEN** a stop lies inside an imported region
- **THEN** the served lines are returned from `osm_transit_route_stops` without a remote query

## ADDED Requirements (shard-distribution)

### Requirement: Content-addressed shards

The system SHALL verify every shard payload against its committed SHA-256 and
Merkle root before it can enter the local index.

#### Scenario: Tampered shard

- **WHEN** a source returns bytes that do not match the descriptor
- **THEN** the payload is discarded, the failure is logged, and the next source is tried

### Requirement: Peer-first fetching

The system SHALL prefer sources that already hold the bytes (pack-local reads,
seeding peers) over third-party archives.

#### Scenario: Peer has the shard

- **WHEN** a peer source yields a verifying payload
- **THEN** no archive is contacted

### Requirement: Verifiable peer answers

The system SHALL accept peer-computed query answers only when every returned row
carries an inclusion proof that chains to the Merkle root committed in the
manifest, and SHALL reject an answer that omits committed rows when the expected
count is known.

#### Scenario: Fabricated row

- **WHEN** a responder alters any field of a returned row
- **THEN** verification fails and the client uses none of the answer

#### Scenario: Truncated answer

- **WHEN** the expected row count is known and the verified answer is shorter
- **THEN** the answer is rejected as incomplete
