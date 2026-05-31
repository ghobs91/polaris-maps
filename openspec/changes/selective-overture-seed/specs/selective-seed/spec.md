## ADDED Requirements

### Requirement: Selective seed on POI detail view mount

The system SHALL automatically submit an Overture-sourced POI to OpenStreetMap when the user opens its detail view, provided the POI is not already in OSM, the user is authenticated with OSM, and POI contributions are enabled.

#### Scenario: Overture POI not in OSM — auto-submitted

- **WHEN** the user opens the detail view for an Overture-sourced POI
- **AND** the user is signed into OSM with a valid access token
- **AND** POI contributions are enabled in settings
- **AND** `checkPoiExistsInOsm()` returns false (POI not found in OSM)
- **THEN** the system SHALL extract OSM-compatible tags from the Place model
- **AND** create a new OSM changeset
- **AND** create the OSM node via the OSM API v0.6
- **AND** close the changeset
- **AND** record the submission in the in-memory dedup set

#### Scenario: Overture POI already in OSM — skipped

- **WHEN** the user opens the detail view for an Overture-sourced POI
- **AND** `checkPoiExistsInOsm()` returns true (POI matched in OSM)
- **THEN** the system SHALL NOT submit the POI
- **AND** the detail view SHALL render normally with no submission

#### Scenario: Not Overture-sourced — no action

- **WHEN** the user opens the detail view for a community-sourced or OSM-sourced POI
- **THEN** the system SHALL NOT attempt any auto-submission

#### Scenario: User not authenticated — no action

- **WHEN** the user opens the detail view for an Overture-sourced POI
- **AND** the user is not signed into OSM
- **THEN** the system SHALL NOT attempt any auto-submission

#### Scenario: Contributions disabled — no action

- **WHEN** the user opens the detail view for an Overture-sourced POI
- **AND** POI contributions are disabled in settings
- **THEN** the system SHALL NOT attempt any auto-submission

### Requirement: Session-scoped deduplication set

The system SHALL maintain an in-memory set of successfully-submitted POI identifiers to prevent duplicate submissions within the same app session.

#### Scenario: POI already submitted this session — skipped

- **WHEN** the user opens the detail view for an Overture-sourced POI
- **AND** the POI's key (name + rounded lat/lng) is in the in-memory dedup set
- **THEN** the system SHALL NOT submit the POI
- **AND** SHALL NOT call `checkPoiExistsInOsm()` (dedup check is sufficient)

#### Scenario: First open this session — existence check runs

- **WHEN** the user opens the detail view for an Overture-sourced POI
- **AND** the POI's key is NOT in the in-memory dedup set
- **THEN** the system SHALL call `checkPoiExistsInOsm()` to determine if submission is needed

#### Scenario: Successful submission — key added to dedup set

- **WHEN** an Overture-sourced POI is successfully submitted to OSM
- **THEN** the POI's key SHALL be added to the in-memory dedup set

### Requirement: Fail-open on existence check error

The system SHALL proceed with submission when `checkPoiExistsInOsm()` throws an error, rather than blocking the submission.

#### Scenario: Overpass API unavailable

- **WHEN** `checkPoiExistsInOsm()` throws an error due to Overpass API being unavailable
- **AND** all other activation conditions are met
- **THEN** the system SHALL proceed with submitting the POI to OSM
- **AND** SHALL NOT surface the error to the user

### Requirement: One changeset per submission

The system SHALL create and close a single OSM changeset for each selective auto-submission, with a comment indicating the source.

#### Scenario: Changeset lifecycle

- **WHEN** an Overture-sourced POI passes existence check and is submitted
- **THEN** the system SHALL create a new changeset with the comment `"Added Overture Maps POI via Polaris Maps"`
- **AND** tag the changeset with `created_by=Polaris Maps`
- **AND** close the changeset immediately after the node is created
