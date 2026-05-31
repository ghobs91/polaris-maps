## ADDED Requirements

### Requirement: Auto-seed activation gates

The system SHALL only activate auto-seeding when ALL of the following conditions are met: the user is signed into OSM, POI contributions are enabled in settings, POIs are currently visible on the map, and the map zoom level is at or above the POI display threshold (zoom >= 14).

#### Scenario: All conditions met

- **WHEN** the user is signed into OSM, `poiContributionsEnabled` is true, POIs are visible on the map, and zoom >= 14
- **THEN** the auto-seed timer SHALL start

#### Scenario: User not signed into OSM

- **WHEN** `poiContributionsEnabled` is true and POIs are visible but the user has no OSM access token
- **THEN** the auto-seed timer SHALL NOT start

#### Scenario: POI contributions disabled

- **WHEN** the user is signed into OSM and POIs are visible but `poiContributionsEnabled` is false
- **THEN** the auto-seed timer SHALL NOT start

#### Scenario: Map zoomed out below POI threshold

- **WHEN** all other conditions are met but map zoom is below 14
- **THEN** the auto-seed timer SHALL NOT start

#### Scenario: Conditions change mid-session

- **WHEN** the auto-seed timer is running and any activation condition becomes false (user signs out, contributions disabled, zoom drops below 14)
- **THEN** the auto-seed timer SHALL stop immediately

### Requirement: Auto-seed submission interval

The system SHALL submit at most one Overture-sourced POI to OpenStreetMap every 10 seconds. Each submission MUST complete (success or failure) before the next 10-second countdown begins.

#### Scenario: Successful submission

- **WHEN** a POI is submitted and the OSM API responds with success within 5 seconds
- **THEN** the system SHALL wait the remaining 5+ seconds (to total 10 seconds from submission start) before selecting and submitting the next POI

#### Scenario: Slow API response

- **WHEN** a POI submission takes longer than 10 seconds to receive an API response
- **THEN** the next submission SHALL begin immediately after the current one completes (no additional delay)

#### Scenario: API returns 429 rate limit

- **WHEN** the OSM API returns HTTP 429 (Too Many Requests)
- **THEN** the system SHALL double the interval (exponential backoff: 10s → 20s → 40s → 80s → 160s → max 5 minutes)
- **AND** if the API returns 429 three consecutive times, the system SHALL pause auto-seeding for 5 minutes before retrying

### Requirement: POI selection for auto-seeding

The system SHALL select POIs for auto-seeding from the set of currently visible Overture-sourced POIs that have not already been submitted in the current session.

#### Scenario: Eligible POI available

- **WHEN** the auto-seed timer fires and there is at least one visible POI with `polaris:source === 'overture'` and a negative ID that has not been seeded this session
- **THEN** the system SHALL randomly select one such POI for submission

#### Scenario: No eligible POI

- **WHEN** the auto-seed timer fires and all visible Overture-sourced POIs have already been seeded this session, or no Overture-sourced POIs are visible
- **THEN** the system SHALL skip this interval and retry at the next interval

#### Scenario: Already-seeded POI tracking

- **WHEN** a POI is successfully submitted to OSM
- **THEN** its ID SHALL be added to the in-memory set of seeded POI IDs to prevent duplicate submission within the session

### Requirement: Headless POI submission

The system SHALL provide a function that accepts a Place model and an OSM access token, converts the Place tags to OSM-compatible tags, and creates an OSM node via the OSM API v0.6 without requiring user interaction or form input.

#### Scenario: Successful headless submission

- **WHEN** `submitPlaceAuto(place, accessToken)` is called with a valid Place and token
- **THEN** the system SHALL extract OSM-compatible tags from the Place model using `placeToOsmTags()`
- **AND** create or reuse an active OSM changeset
- **AND** call the OSM API to create the node
- **AND** return the created node ID and changeset ID

#### Scenario: Headless submission failure

- **WHEN** `submitPlaceAuto` encounters an API error (network failure, invalid token, etc.)
- **THEN** the system SHALL return an error result without throwing
- **AND** the auto-seed timer SHALL proceed to the next interval without blocking

### Requirement: Auto-seed changeset management

The system SHALL maintain a single active OSM changeset for all auto-seed submissions during a session, with a comment indicating the source.

#### Scenario: Changeset created on first submission

- **WHEN** the first auto-seed submission of a session begins and no active changeset exists
- **THEN** the system SHALL create a new OSM changeset with the comment "Adding POIs from Overture Maps via Polaris Maps"
- **AND** tag the changeset with `created_by=Polaris Maps` and `source=Overture Maps`

#### Scenario: Existing changeset reused

- **WHEN** a subsequent auto-seed submission begins and an active changeset already exists
- **THEN** the system SHALL reuse the existing changeset without creating a new one

#### Scenario: Changeset closed on session end

- **WHEN** the auto-seed timer stops (user signs out, contributions disabled, app backgrounds, or leaves map view)
- **THEN** the system SHALL close the active changeset via the OSM API

#### Scenario: Changeset rotated after 1000 nodes

- **WHEN** an active changeset has been used for 1000 successful auto-seed submissions
- **THEN** the system SHALL close the current changeset and create a new one for subsequent submissions

### Requirement: Auto-seed visual feedback

The system SHALL provide persistent but unobtrusive visual feedback indicating that auto-seeding is active and how many POIs have been submitted in the current session.

#### Scenario: Auto-seed becomes active

- **WHEN** the auto-seed timer starts
- **THEN** the system SHALL display a small indicator (e.g., a pill/badge) showing the count of POIs seeded this session

#### Scenario: POI successfully seeded

- **WHEN** a POI is successfully submitted via auto-seed
- **THEN** the seeded count displayed in the indicator SHALL increment by one
- **AND** a brief pulse or subtle animation SHALL play on the indicator

#### Scenario: Auto-seed becomes inactive

- **WHEN** the auto-seed timer stops for any reason
- **THEN** the auto-seed indicator SHALL be removed from the UI

### Requirement: One-time auto-seed consent

The system SHALL present a one-time consent dialog before activating auto-seeding for the first time in the app's lifetime.

#### Scenario: First auto-seed activation

- **WHEN** all activation conditions are met for the first time and the user has never previously granted auto-seed consent
- **THEN** the system SHALL show a consent dialog explaining that POIs will be automatically submitted to OpenStreetMap
- **AND** provide "Enable" and "Not Now" options

#### Scenario: User grants consent

- **WHEN** the user taps "Enable" on the consent dialog
- **THEN** auto-seeding SHALL activate
- **AND** the consent preference SHALL be persisted so the dialog is never shown again

#### Scenario: User declines consent

- **WHEN** the user taps "Not Now" on the consent dialog
- **THEN** auto-seeding SHALL NOT activate
- **AND** the consent dialog SHALL be shown again on the next app launch when conditions are met
