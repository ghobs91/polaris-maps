## ADDED Requirements

### Requirement: OSM account section in Settings

The Settings screen SHALL include an "OpenStreetMap Account" section that displays the user's OSM login state and provides login/logout actions.

#### Scenario: User is not logged in

- **WHEN** the user opens Settings and no OSM access token exists
- **THEN** the OSM Account section displays a "Sign in to OpenStreetMap" button
- **AND** no account details are shown

#### Scenario: User is logged in

- **WHEN** the user opens Settings and a valid OSM access token exists
- **THEN** the OSM Account section displays the user's OSM display name and avatar
- **AND** a "Sign Out" button is shown

#### Scenario: User taps login button

- **WHEN** the user taps "Sign in to OpenStreetMap" in Settings
- **THEN** the OAuth 2.0 + PKCE login flow is initiated via the existing `osmAuthStore.login()` method
- **AND** the Settings screen updates to show the logged-in state upon successful authentication

#### Scenario: User taps logout button

- **WHEN** the user taps "Sign Out" in the OSM Account section
- **THEN** the system SHALL call `osmAuthStore.logout()`, clearing the access token from secure storage
- **AND** the Settings screen reverts to the logged-out state
- **AND** auto-seeding is immediately disabled if it was active

### Requirement: OSM contributions display

When the user is logged into OSM, the Settings screen SHALL display contribution statistics and a list of recent contributions fetched from the OSM API.

#### Scenario: Contributions stats displayed

- **WHEN** the user opens Settings and is logged into OSM
- **THEN** the OSM Account section SHALL show a "My OpenStreetMap Contributions" area
- **AND** display the total count of changesets and nodes created by the user
- **AND** display the count of auto-seeded nodes contributed in the current session

#### Scenario: View latest contributions

- **WHEN** the user taps "View Latest Contributions" in the OSM Account section
- **THEN** the system SHALL fetch and display a list of the user's most recent OSM changesets (including changeset comment, timestamp, and node count)
- **OR** open the user's OSM profile page in the system browser showing their edit history

#### Scenario: Contributions stats update after auto-seed

- **WHEN** an auto-seed submission completes successfully
- **THEN** the total contributions count and session auto-seed count in the OSM Account section SHALL increment to reflect the new contribution

### Requirement: OSM edit screen redirects to Settings when unauthenticated

When a user navigates to the OSM edit/create screen (`/poi/osm-edit`) without an active OSM session, the system SHALL redirect them to the Settings screen instead of showing an inline login prompt.

#### Scenario: Unauthenticated user opens OSM edit screen

- **WHEN** a user navigates to `/poi/osm-edit` without a valid OSM access token
- **THEN** the system SHALL redirect to the Settings screen
- **AND** display a brief message indicating OSM sign-in is required for editing

#### Scenario: Authenticated user opens OSM edit screen

- **WHEN** a user navigates to `/poi/osm-edit` with a valid OSM access token
- **THEN** the edit form displays normally with pre-filled tags
