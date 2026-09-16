## ADDED Requirements

### Requirement: Cache last-viewed place details

The system SHALL cache, on the device, the details of each place the user views. The cached snapshot SHALL include opening hours, phone number, address, website and menu URL, media metadata, and a snapshot of the place's reviews. The cache SHALL record when it was written and the version of the source data.

#### Scenario: Viewing a place caches its details

- **WHEN** the user opens a place detail while online
- **THEN** the resolved details SHALL be written to the local cache with a cached-at timestamp

#### Scenario: Reviews snapshot stored with details

- **WHEN** place details are cached and the place has reviews
- **THEN** the reviews visible at that time SHALL be stored in the snapshot with their attribution preserved

### Requirement: Offline read path

When the device is offline or a live source fails, the system SHALL serve the cached place detail instead of an error, and SHALL clearly mark the detail as offline. Live data SHALL take precedence over cached data whenever it is available.

#### Scenario: Offline place detail served from cache

- **WHEN** the user opens a previously viewed place while offline
- **THEN** the cached hours, phone, address, media metadata, and reviews snapshot SHALL be displayed
- **AND** the detail SHALL be marked as offline

#### Scenario: Fresh data overrides cache

- **WHEN** live enrichment succeeds for a place with a cached snapshot
- **THEN** the live values SHALL be displayed and the cache SHALL be refreshed

### Requirement: Explicit staleness indication

Whenever a cached snapshot is served, the system SHALL display how old the snapshot is and SHALL NOT present stale data as current. The system SHALL attempt a refresh when connectivity returns.

#### Scenario: Cached-at time shown

- **WHEN** a place detail is shown from the cache
- **THEN** the last-updated time derived from the cached-at timestamp SHALL be visible

#### Scenario: Refresh on reconnect

- **WHEN** connectivity is restored while a cached place detail is displayed
- **THEN** the system SHALL attempt to refresh the detail and update the staleness indicator on success

### Requirement: Region-pack integration

Where a downloaded region pack carries place-detail data, the system SHALL seed or refresh the place-detail cache from that pack. Region-pack data SHALL NOT overwrite a cached snapshot that is newer than the pack's source version.

#### Scenario: Region pack seeds offline details

- **WHEN** a region pack containing place details is installed
- **THEN** those details SHALL be available offline for the covered places

#### Scenario: Newer cache is preserved

- **WHEN** a region pack's place-detail data is older than an existing cached snapshot
- **THEN** the existing snapshot SHALL NOT be replaced by the older pack data

### Requirement: Bounded cache storage and user control

The place-detail cache SHALL be bounded and SHALL evict the least recently viewed entries when it exceeds its limit. The user SHALL be able to clear cached place details from settings.

#### Scenario: Eviction on overflow

- **WHEN** caching a new place detail would exceed the configured cache limit
- **THEN** the least recently viewed cached place SHALL be evicted

#### Scenario: User clears cached details

- **WHEN** the user clears cached place details from settings
- **THEN** all cached place-detail snapshots SHALL be removed

### Requirement: Cache keyed by stable place identity

The system SHALL key the place-detail cache by the place's canonical identifier and SHALL merge duplicate identifiers for the same place so that a place viewed from search and from a saved list shares one cached snapshot.

#### Scenario: Same place from two entry points shares a snapshot

- **WHEN** a place is opened from search and later from a saved list
- **THEN** both views SHALL read the same cached snapshot
