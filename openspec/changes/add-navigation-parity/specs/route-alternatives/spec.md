## ADDED Requirements

### Requirement: Alternative routes are computed

The routing service SHALL request multiple route alternatives from the routing provider when a route is computed on a provider path that supports alternatives, and SHALL return at least the primary route when no alternatives are available.

#### Scenario: Provider returns alternatives

- **WHEN** a route preview is requested between an origin and a destination
- **THEN** the routing service SHALL request at least two alternatives from the routing provider
- **AND** the returned result SHALL include the primary route and each alternative route

#### Scenario: Provider returns no alternatives

- **WHEN** the routing provider returns only a primary route or does not support alternatives
- **THEN** the app SHALL show the route preview with the primary route only
- **AND** the app SHALL NOT show an empty or broken alternatives list

#### Scenario: Alternatives preserve waypoints and preferences

- **WHEN** the route includes intermediate waypoints or enabled avoid-tolls, avoid-highways, or avoid-ferries preferences
- **THEN** every computed alternative SHALL be computed with the same ordered waypoints and the same preferences

### Requirement: Alternatives are displayed before driving

The app SHALL display route alternatives on the map and as selectable cards showing duration, distance, and delay relative to the fastest route.

#### Scenario: Alternatives rendered on map and as cards

- **WHEN** multiple routes are available in route preview
- **THEN** each alternative SHALL be drawn as a distinct polyline on the map
- **AND** each alternative SHALL appear as a card showing time, distance, and delay relative to the fastest route

#### Scenario: Selecting an alternative in preview

- **WHEN** the user selects an alternative card
- **THEN** that route SHALL become the selected primary route
- **AND** the map SHALL emphasize the selected route geometry
- **AND** the displayed ETA and distance SHALL update to the selected route

### Requirement: Alternatives can be switched during navigation

The app SHALL allow the user to switch to an alternative route while guidance is active without ending navigation.

#### Scenario: Switching during active navigation

- **WHEN** navigation is active and at least one alternative route exists
- **THEN** the user SHALL be able to select an alternative
- **AND** guidance SHALL continue on the selected route from the user's current position
- **AND** the app SHALL restart route tracking on the selected route geometry

#### Scenario: Switching preserves waypoints

- **WHEN** the active route has intermediate waypoints and the user switches alternatives
- **THEN** the new route SHALL retain the same ordered waypoints
- **AND** the app SHALL continue guidance toward the next unreached waypoint

#### Scenario: Stale alternatives are not offered

- **WHEN** the route has been recomputed or the user has switched alternatives
- **THEN** alternatives computed for the previous route SHALL NOT be selectable until alternatives for the current route are recomputed
