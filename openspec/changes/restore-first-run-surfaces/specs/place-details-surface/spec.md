## ADDED Requirements

### Requirement: The primary place card opens the place-details screen

The primary place card shown over the map SHALL provide a reachable affordance that navigates to the existing place-details screen at `/poi/[id]` for the selected place. The place-details screen MUST render the selected place's information and MUST be reachable through an in-app user action, not only by direct path.

#### Scenario: Open details from the card

- **WHEN** the user selects a place on the map and activates the details affordance
- **THEN** the app navigates to the place-details screen showing that place's information

#### Scenario: Return to the map

- **WHEN** the user navigates back from the place-details screen
- **THEN** the map is shown again and the previously selected place remains available to the user

### Requirement: Map-selected places resolve to a place-details record

The app SHALL resolve a place selected from the map to an identifier the place-details screen can load, covering local Overture and OSM places as well as synthetic map-selection places, so opening details shows the correct place.

#### Scenario: Overture or OSM place

- **WHEN** a place sourced from local Overture data or OSM is opened from the map
- **THEN** the place-details screen loads that place's record and renders its name, category, and available fields

#### Scenario: Unresolvable place

- **WHEN** a selected place cannot be resolved to a stored record
- **THEN** the app shows an actionable message instead of a blank details screen

### Requirement: Local reviews are reachable from the primary place UI

The primary place UI SHALL indicate the presence of locally stored reviews for the selected place and SHALL provide a path to view and add reviews from the place-details screen. The card MUST NOT present only a third-party transient rating while leaving local reviews unreachable.

#### Scenario: Place has local reviews

- **WHEN** the selected place has local reviews
- **THEN** the place UI indicates their presence and the details screen lists them and offers a write-review action

#### Scenario: Place has no local reviews

- **WHEN** the selected place has no local reviews
- **THEN** the details screen offers a write-review action without showing an empty reviews section

### Requirement: Peer edits, attestation, and imagery are reachable from place details

The place-details screen SHALL expose peer-proposed edits, proof-of-presence attestation, and nearby street imagery for the selected place.

#### Scenario: Pending peer edits exist

- **WHEN** the place has pending peer edits
- **THEN** the details screen lists them with their corroboration and dispute counts

#### Scenario: Attestation is available

- **WHEN** the user opens the details screen for a place
- **THEN** a verify-presence action is available and submits a signed proof-of-presence attestation

#### Scenario: Nearby imagery exists

- **WHEN** street imagery exists near the place
- **THEN** the details screen shows a photo strip that opens the imagery viewer

### Requirement: No orphaned screens

Every screen registered in the root navigation stack SHALL be reachable through at least one in-app navigation path, and stores used only by a registered screen MUST be reachable through that path. A registered screen with no in-app entry point MUST be either wired up or removed.

#### Scenario: Registered routes are reachable

- **WHEN** the root stack registration is audited
- **THEN** each registered screen has at least one in-app navigation caller

#### Scenario: Orphan removed or wired

- **WHEN** a registered screen has no in-app caller
- **THEN** an in-app entry point is added or the orphaned screen is removed, so no registered screen is unreachable
