## ADDED Requirements

### Requirement: Current speed display

The app SHALL display the user's current speed during active navigation.

#### Scenario: Speed shown while moving

- **WHEN** navigation is active and the device reports a valid speed
- **THEN** the app SHALL display the current speed in the user's preferred units

#### Scenario: Speed hidden when unavailable

- **WHEN** navigation is active and the device reports no valid speed
- **THEN** the app SHALL NOT display a stale or invalid current speed

### Requirement: Speed-limit and over-speed alerts

The app SHALL alert the user when the speed limit changes on the active route and when the user exceeds the current speed limit.

#### Scenario: Speed-limit change

- **WHEN** the speed limit for the active route changes to a different value
- **THEN** the app SHALL update the speed-limit display
- **AND** the app SHALL alert the user of the change

#### Scenario: Over-speed alert

- **WHEN** the user's current speed exceeds the current speed limit by more than the alert threshold
- **THEN** the app SHALL alert the user that they are over the speed limit
- **AND** the app SHALL NOT repeat the alert while the user remains over the limit

### Requirement: Lane guidance and speed limits are preserved on offline and fallback routes

The app SHALL map lane guidance and speed-limit data from native route payloads into the shared route model so these fields are available on offline Valhalla and MapKit fallback routes.

#### Scenario: Offline Valhalla route keeps lane and speed data

- **WHEN** an offline native Valhalla route includes lane guidance or speed-limit data for a maneuver
- **THEN** the mapped route SHALL include that lane guidance and speed-limit data
- **AND** the navigation UI SHALL display it

#### Scenario: Fallback route keeps available maneuver text

- **WHEN** a MapKit fallback route includes street names or verbal post-transition instructions
- **THEN** the mapped route SHALL include those fields
- **AND** voice guidance SHALL use them

#### Scenario: Absent data is omitted, not faked

- **WHEN** a native route payload does not include lane guidance or speed-limit data
- **THEN** the mapped route SHALL omit those fields
- **AND** the app SHALL NOT display lane guidance or a speed-limit sign for that maneuver

### Requirement: Search along the route

The app SHALL let the user search for places along the active route corridor rather than only near the current position.

#### Scenario: Corridor search results

- **WHEN** the user performs a search while navigation is active
- **THEN** the app SHALL rank results by their proximity to the active route corridor
- **AND** the app SHALL present those results for selection as a stop

### Requirement: Steps list during navigation

The app SHALL show a list of maneuvers for the active route during navigation.

#### Scenario: Steps list contents

- **WHEN** navigation is active
- **THEN** the app SHALL show the route's maneuvers in order
- **AND** the app SHALL indicate the current maneuver in the list

#### Scenario: Steps list reflects route changes

- **WHEN** the active route is replaced by a reroute or alternative
- **THEN** the steps list SHALL update to the maneuvers of the current route
