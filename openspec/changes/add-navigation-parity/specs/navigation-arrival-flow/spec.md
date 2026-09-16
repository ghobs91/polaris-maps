## ADDED Requirements

### Requirement: Waypoint arrival is detected

The app SHALL detect arrival at an intermediate waypoint using both GPS proximity to the waypoint and progress along the active route.

#### Scenario: Reaching an intermediate waypoint

- **WHEN** the user's position is within the waypoint arrival radius
- **AND** route progress indicates the current leg has reached that waypoint
- **THEN** the app SHALL mark the waypoint as reached

#### Scenario: Passing near a waypoint without arriving

- **WHEN** the user's position is within the waypoint arrival radius
- **AND** route progress indicates substantial distance remains to that waypoint
- **THEN** the app SHALL NOT mark the waypoint as reached

### Requirement: Legs auto-advance on arrival

The app SHALL automatically advance to the next leg when arrival at an intermediate waypoint is detected, when auto-advance is enabled in settings.

#### Scenario: Auto-advance enabled

- **WHEN** arrival at an intermediate waypoint is detected and auto-advance is enabled
- **THEN** the app SHALL advance to the next leg
- **AND** guidance SHALL continue toward the next waypoint or destination

#### Scenario: Auto-advance disabled

- **WHEN** arrival at an intermediate waypoint is detected and auto-advance is disabled
- **THEN** the app SHALL show an arrival prompt for that waypoint
- **AND** the app SHALL wait for the user to continue or stop navigation

### Requirement: Destination arrival is detected

The app SHALL detect arrival at the final destination.

#### Scenario: Reaching the destination

- **WHEN** the user's position is within the destination arrival radius
- **AND** route progress indicates the final leg has been completed
- **THEN** the app SHALL declare arrival at the destination

#### Scenario: False positive avoidance

- **WHEN** the user passes near the destination
- **AND** route progress indicates substantial remaining distance on the final leg
- **THEN** the app SHALL NOT declare arrival

### Requirement: Arrival summary is shown

The app SHALL show an arrival summary when arrival at the destination is declared.

#### Scenario: Summary contents

- **WHEN** arrival at the final destination is declared
- **THEN** the app SHALL show a summary including the destination name, elapsed time, and total distance

### Requirement: Navigation auto-ends on arrival

The app SHALL be able to automatically end navigation after arrival, when auto-end is enabled in settings.

#### Scenario: Auto-end enabled

- **WHEN** arrival at the destination is declared and auto-end is enabled
- **THEN** the app SHALL stop navigation after the arrival summary is dismissed or a short delay elapses
- **AND** the app SHALL return to the map

#### Scenario: Auto-end disabled

- **WHEN** arrival at the destination is declared and auto-end is disabled
- **THEN** navigation SHALL remain active until the user exits

### Requirement: Arrival is announced

The app SHALL announce arrival at waypoints and at the destination.

#### Scenario: Announcement on arrival

- **WHEN** arrival at a waypoint or the destination is declared
- **THEN** the app SHALL speak an arrival announcement
- **AND** the app SHALL trigger a success haptic
