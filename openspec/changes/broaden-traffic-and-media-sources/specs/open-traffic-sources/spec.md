## ADDED Requirements

### Requirement: P2P probes and peer-shared tiles are the primary traffic source

The system SHALL source traffic primarily from P2P speed probes contributed by peers and from P2P-shared traffic tiles, aggregated locally. P2P data MUST take precedence over every external feed.

#### Scenario: P2P probes populate the traffic store

- **WHEN** connected peers contribute speed probes
- **THEN** the traffic store is populated from locally aggregated P2P probes

#### Scenario: Traffic tiles resolve from cache or peers first

- **WHEN** a traffic tile is requested for the current viewport
- **THEN** it is resolved from the local cache or from peers before any external feed is consulted

#### Scenario: Peer-shared tiles are served to other peers

- **WHEN** a peer requests a traffic tile this node holds
- **THEN** the tile is served from the local cache

### Requirement: Free open traffic feeds bootstrap coverage

The system SHALL support optional free open traffic feeds, such as government 511, DATEX II, and NL NDW, to bootstrap coverage where P2P density is insufficient. Free-keyed government or open feeds are permitted; paid feeds, and free tiers that bill or block after a quota, are prohibited.

#### Scenario: Open feed available for the region

- **WHEN** a free open traffic feed is configured and covers the current viewport
- **THEN** the feed is queried only for cells not already resolved by local cache or peers
- **AND** its segments are normalized and merged as lower-priority data

#### Scenario: No open feed covers the region

- **WHEN** no open feed is configured or covers the current viewport
- **THEN** the system proceeds without an external feed
- **AND** no error beyond the coverage state is surfaced to the user

#### Scenario: Open feed failure is non-fatal

- **WHEN** a configured open feed is unreachable or returns an invalid response
- **THEN** the feed is treated as contributing no data
- **AND** traffic resolution continues with the remaining tiers

### Requirement: Traffic resolution follows a defined precedence

Traffic conditions SHALL resolve in the following precedence order: local cache (fresh, then historical) → P2P peers → open feed → optional TomTom cold-start bridge (only if configured) → no-data state. A later tier MUST be consulted only for cells that no earlier tier resolved.

#### Scenario: Local data short-circuits later tiers

- **WHEN** local cache resolves every requested cell
- **THEN** peers, open feeds, and the cold-start bridge are not queried

#### Scenario: Precedence falls through in order

- **WHEN** a requested cell is not resolved by local cache
- **THEN** peers are consulted before any open feed
- **AND** the open feed is consulted only if peers do not resolve the cell
- **AND** the cold-start bridge is consulted only if neither peers nor an open feed resolve the cell

#### Scenario: Unresolved cells reach the no-data state

- **WHEN** no tier resolves a requested cell
- **THEN** the cell is reported as unresolved
- **AND** the UI presents the no-data coverage state

### Requirement: TomTom is an optional, lower-priority cold-start fallback

TomTom flow and raster bootstrap MAY be retained as an optional lowest-priority cold-start fallback while P2P density and open-feed coverage are insufficient. It MUST be config-gated, MUST be absent by default without error, MUST NOT be required by any feature, and MUST be removed once P2P and feed coverage suffice.

#### Scenario: Cold-start bridge absent by default

- **WHEN** the app runs without a TomTom key configured
- **THEN** traffic resolves from local cache, P2P peers, and open feeds
- **AND** no feature is disabled and no error is surfaced

#### Scenario: Cold-start bridge used only last

- **WHEN** a cell is unresolved by local cache, peers, and open feeds and a TomTom key is configured
- **THEN** the cold-start bridge may resolve the cell as the lowest-priority tier
- **AND** its result is marked distinctly from P2P and open-feed coverage

#### Scenario: Cold-start bridge failure is non-fatal

- **WHEN** the configured cold-start bridge is unreachable or returns no data
- **THEN** the cell falls through to the no-data coverage state
- **AND** no blocking error is surfaced

### Requirement: Traffic coverage state is surfaced in the UI

The UI SHALL expose the current traffic coverage and resolve source, distinguishing P2P-sourced, open-feed-sourced, cold-start-sourced, stale, and no-data conditions.

#### Scenario: Source label reflects P2P resolution

- **WHEN** traffic for the viewport is resolved from peers
- **THEN** the UI indicates P2P-sourced coverage

#### Scenario: Source label reflects open-feed resolution

- **WHEN** traffic for the viewport is resolved from an open feed
- **THEN** the UI indicates that open-feed source instead of P2P

#### Scenario: Source label reflects cold-start resolution

- **WHEN** traffic for the viewport is resolved from the cold-start bridge
- **THEN** the UI indicates a distinct bootstrap/cold-start source

#### Scenario: No-data viewport shows an explicit state

- **WHEN** the viewport has no traffic data from any tier
- **THEN** the UI shows an explicit no-data traffic state
- **AND** it does not render an unexplained empty or stale overlay

### Requirement: HERE traffic dead code is removed

The unwired HERE traffic integration SHALL be deleted, including `hereFetcher.ts`, the HERE endpoint constant, the HERE API-key constant, and associated tests.

#### Scenario: HERE module and constants are gone

- **WHEN** the change is complete
- **THEN** the HERE fetcher module no longer exists
- **AND** no HERE endpoint or key constant remains in the configuration

#### Scenario: Documentation no longer claims HERE traffic

- **WHEN** the change is complete
- **THEN** the traffic README and any map legend do not describe HERE as an active source
