## MODIFIED Requirements

### Requirement: Auto-seed activation gates

The system SHALL activate selective auto-seeding when: the user is signed into OSM with a valid access token AND POI contributions are enabled in settings. Auto-seeding triggers once per POI detail view open for Overture-sourced POIs, NOT on a periodic timer.

#### Scenario: All conditions met — detail view opened

- **WHEN** the user opens the detail view for an Overture-sourced POI
- **AND** the user is signed into OSM
- **AND** `poiContributionsEnabled` is true
- **THEN** the system SHALL attempt auto-submission for that specific POI

#### Scenario: User not signed into OSM

- **WHEN** the user opens the detail view for an Overture-sourced POI
- **AND** the user has no OSM access token
- **THEN** the system SHALL NOT attempt auto-submission

#### Scenario: POI contributions disabled

- **WHEN** the user opens the detail view for an Overture-sourced POI
- **AND** `poiContributionsEnabled` is false
- **THEN** the system SHALL NOT attempt auto-submission

### Requirement: Headless POI submission

The system SHALL provide a function that accepts a Place model and an OSM access token, checks OSM for an existing POI with the same name within 50m, and creates an OSM node only if no match is found. Each submission creates its own changeset.

#### Scenario: Successful headless submission

- **WHEN** a selective auto-submission is triggered for an Overture-sourced Place
- **AND** `checkPoiExistsInOsm()` returns false
- **THEN** the system SHALL extract OSM-compatible tags using `placeToOsmTags()`
- **AND** create a new OSM changeset with comment "Added Overture Maps POI via Polaris Maps"
- **AND** call the OSM API to create the node
- **AND** close the changeset
- **AND** return the created node ID and changeset ID

#### Scenario: POI already exists in OSM

- **WHEN** a selective auto-submission is triggered
- **AND** `checkPoiExistsInOsm()` returns true
- **THEN** the system SHALL skip submission and return a result indicating the POI already exists

#### Scenario: Headless submission failure

- **WHEN** the OSM API returns an error during node creation (network failure, invalid token, etc.)
- **THEN** the system SHALL surface the error via the existing error handling in the detail page
- **AND** best-effort close the changeset

### Requirement: Auto-seed changeset management

The system SHALL create a dedicated OSM changeset for each auto-submission, tagged with `created_by=Polaris Maps`, and close it immediately after node creation.

#### Scenario: Changeset created per submission

- **WHEN** a selective auto-submission begins
- **THEN** the system SHALL create a new OSM changeset with the comment "Added Overture Maps POI via Polaris Maps"
- **AND** tag the changeset with `created_by=Polaris Maps`

#### Scenario: Changeset closed after node creation

- **WHEN** the OSM node is successfully created
- **THEN** the system SHALL close the changeset via the OSM API

#### Scenario: Changeset closed on submission failure

- **WHEN** the OSM node creation fails
- **THEN** the system SHALL make a best-effort attempt to close the changeset

## REMOVED Requirements

### Requirement: Auto-seed submission interval

**Reason**: Replaced by on-demand triggering per POI detail view open. Interval timing is no longer needed.
**Migration**: No migration needed. The `useOsmAutoSeed` hook and its timer infrastructure are removed entirely.

### Requirement: POI selection for auto-seeding

**Reason**: Replaced by explicit user-initiated POI detail view opening. Random selection and per-session tracking are no longer needed.
**Migration**: The `seededIds` Set and random selection logic in `useOsmAutoSeed` are removed. Replaced by the in-memory dedup Set in the `selective-seed` capability.

### Requirement: Auto-seed visual feedback

**Reason**: With on-demand triggering, there is no background process to indicate. Successful submissions are tracked by OSM changesets visible on the user's OSM profile.
**Migration**: The `AutoSeedIndicator` component and its related callbacks (`setAutoSeedCountCallback`, `setAutoSeedResultCallback`) are removed.

### Requirement: One-time auto-seed consent

**Reason**: Consent is no longer needed because submissions only occur when the user actively opens a POI detail view — a deliberate action that implies intent to review and potentially contribute the data.
**Migration**: The consent dialog, `autoSeedConsentGiven` state, and `setAutoSeedConsentGiven` action in `settingsStore` are removed.
