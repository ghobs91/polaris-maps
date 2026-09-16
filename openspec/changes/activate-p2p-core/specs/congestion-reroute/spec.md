## ADDED Requirements

### Requirement: Route-scoped congestion detection

The system SHALL evaluate congestion only for the portion of the active route ahead of the user's current position, and MUST NOT trigger rerouting based on a global count of congested segments.

#### Scenario: Congestion ahead triggers evaluation

- **WHEN** the active route has congested or stopped segments within the look-ahead window ahead of the current position
- **THEN** the reroute check proceeds

#### Scenario: Congestion behind the user is ignored

- **WHEN** congested segments exist only behind the current position on the active route
- **THEN** no reroute is triggered

#### Scenario: Congestion elsewhere on the map is ignored

- **WHEN** congested segments exist elsewhere on the map but not ahead on the active route
- **THEN** no reroute is triggered

### Requirement: Real GPS origin for rerouting

The system SHALL use the latest GPS position owned by the navigation tracking service as the reroute origin and destination bearing, and MUST NOT add a second location subscription.

#### Scenario: Reroute uses the tracked position

- **WHEN** a congestion reroute is triggered during navigation
- **THEN** the reroute request uses the tracking service's latest position and bearing rather than a zeroed placeholder

#### Scenario: No fix is available

- **WHEN** no tracking fix is available
- **THEN** the reroute is deferred rather than issued from a zeroed origin

### Requirement: Reroute lifecycle follows navigation

The system SHALL start the reroute monitor when navigation starts and stop it when navigation ends.

#### Scenario: Monitor starts with navigation

- **WHEN** navigation becomes active
- **THEN** the reroute monitor is started

#### Scenario: Monitor stops when navigation ends

- **WHEN** navigation is stopped
- **THEN** the reroute monitor is stopped and no further checks run

#### Scenario: Monitor does not run outside navigation

- **WHEN** navigation is not active
- **THEN** no congestion reroute check executes

### Requirement: Anti-thrash reroute guard

The system SHALL replace the active route only when the candidate route is significantly faster, and SHALL rate-limit reroute attempts so the monitor cannot reroute repeatedly in quick succession.

#### Scenario: Insignificant improvement is rejected

- **WHEN** a candidate route's duration does not improve on the active route by more than the significant-delay factor
- **THEN** the active route is left unchanged

#### Scenario: Repeated attempts are throttled

- **WHEN** a reroute attempt has run within the cooldown window
- **THEN** no further reroute attempt is made until the cooldown elapses

#### Scenario: Failed reroute clears the state

- **WHEN** a reroute request fails
- **THEN** the rerouting flag is cleared and the monitor retries subject to the cooldown

### Requirement: Route preferences are respected

The system SHALL forward the user's route preferences to the congestion reroute request.

#### Scenario: Avoidance preferences are applied

- **WHEN** the user has enabled toll, highway, or ferry avoidance
- **THEN** those preferences are included in the reroute request

### Requirement: Reroute state is observable

The system SHALL set and clear the navigation store's rerouting flag around a congestion reroute so the UI can indicate progress.

#### Scenario: Flag set during reroute

- **WHEN** a congestion reroute is in flight
- **THEN** `navigationStore.isRerouting` is true

#### Scenario: Flag cleared after reroute

- **WHEN** the reroute completes or fails
- **THEN** `navigationStore.isRerouting` is false
