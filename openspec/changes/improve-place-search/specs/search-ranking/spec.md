## ADDED Requirements

### Requirement: Calibrated relevance scores

The system SHALL produce relevance scores in the inclusive range 0–100, where a score of 100 requires an exact name or brand match combined with strong proximity, category, and popularity signals. No result SHALL exceed 100.

#### Scenario: Score never exceeds the maximum

- **WHEN** a result matches every scoring dimension at its strongest
- **THEN** its score SHALL be 100 or less

#### Scenario: Distance still breaks ties

- **WHEN** two results have equal scores
- **THEN** the nearer result SHALL rank first

### Requirement: Open-now intent

When the query requests places that are open now, the system SHALL demote or exclude results whose stored opening hours prove them closed at the current time. Results without parseable hours SHALL be treated as unknown and SHALL NOT be excluded.

#### Scenario: Closed place demoted

- **WHEN** the user searches "open now coffee"
- **AND** a candidate has parseable hours showing it is closed
- **THEN** it SHALL rank below equivalent open candidates

#### Scenario: Unknown hours are not excluded

- **WHEN** a candidate has no hours data
- **THEN** it SHALL remain eligible for open-now results

### Requirement: Quality and price intent

When the query requests high quality or cheap places, the system SHALL apply bounded ranking adjustments: a Bayesian-smoothed rating term for quality, and lower price level preference when price data is present.

#### Scenario: Quality intent prefers well-reviewed places

- **WHEN** the user searches "best pizza"
- **AND** two candidates have similar text and distance signals
- **THEN** the candidate with the stronger rating prior SHALL rank first

#### Scenario: Missing rating does not penalize below neutral

- **WHEN** a candidate has no rating data
- **THEN** its popularity term SHALL use the existing neutral default

### Requirement: Brand branch ordering and grouping metadata

When a query matches a brand, the system SHALL order branches by distance from the reference point and SHALL include brand and branch-count metadata sufficient for the UI to group multiple branches of the same brand.

#### Scenario: Nearest branch first

- **WHEN** a brand query returns multiple branches
- **THEN** the nearest branch SHALL rank first
- **AND** each branch SHALL carry the brand name and the total number of matching branches nearby

### Requirement: Personalization from selection history

The system SHALL persist query text together with the selected result locally, and SHALL apply a bounded score boost when a candidate matches a previously selected result for the same query prefix. Personalization data SHALL remain on-device and SHALL NOT affect other users.

#### Scenario: Repeated selection boosted

- **WHEN** the user has previously selected a specific cafe for the query "coffee" three times
- **THEN** that cafe SHALL receive a bounded boost when the same query prefix is searched again

#### Scenario: Boost is bounded

- **WHEN** a personalization boost is applied
- **THEN** the total boost SHALL NOT exceed the configured maximum

### Requirement: Canonical identity deduplication

The system SHALL deduplicate results sharing a canonical identifier before applying fuzzy name-and-distance deduplication. Canonical identifiers are OSM type plus id when present, and the Overture place UUID otherwise.

#### Scenario: Same OSM feature from two sources

- **WHEN** Photon and Overpass both return the same OSM node
- **THEN** the merged result SHALL appear once regardless of the distance between their reported coordinates

#### Scenario: Distinct nearby shops preserved

- **WHEN** two different places with different canonical identifiers are less than 80 meters apart with different names
- **THEN** both SHALL be retained
