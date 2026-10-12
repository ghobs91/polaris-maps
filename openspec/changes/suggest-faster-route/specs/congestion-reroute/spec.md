## MODIFIED Requirements

### Requirement: Route-scoped congestion detection

The system SHALL evaluate congestion only for the portion of the active route ahead of the user's current position, and MUST NOT trigger a reroute based on a global count of congested segments. Congestion ahead SHALL be one trigger for a faster-route comparison, and the system SHALL additionally re-evaluate candidate routes on a periodic interval regardless of congestion so that deviating onto a heavier road is still covered.

#### Scenario: Congestion ahead triggers a comparison

- **WHEN** the active route has congested or stopped segments within the look-ahead window ahead of the current position
- **THEN** a faster-route comparison is run

#### Scenario: Congestion behind the user is ignored

- **WHEN** congested segments exist only behind the current position on the active route
- **THEN** no comparison is triggered on that basis

#### Scenario: Congestion elsewhere on the map is ignored

- **WHEN** congested segments exist elsewhere on the map but not ahead on the active route
- **THEN** no comparison is triggered on that basis

#### Scenario: Periodic comparison without congestion

- **WHEN** no congestion is detected ahead on the active route but the periodic comparison interval has elapsed
- **THEN** a faster-route comparison is run

### Requirement: Anti-thrash reroute guard

The system SHALL NOT replace the active route during navigation without the user's consent. It SHALL surface a faster-route suggestion only when a candidate saves at least the minimum threshold versus the active route's remaining traffic-adjusted time, and SHALL rate-limit suggestions so they cannot reappear repeatedly in quick succession.

#### Scenario: Insignificant improvement is not suggested

- **WHEN** the best candidate does not save at least the minimum threshold versus the active route's remaining time
- **THEN** no suggestion is surfaced and the active route is left unchanged

#### Scenario: Route is never swapped silently

- **WHEN** a faster candidate is found during navigation
- **THEN** the active route remains unchanged until the user accepts the suggestion

#### Scenario: Repeated suggestions are throttled

- **WHEN** a suggestion was dismissed within the cooldown window
- **THEN** no further suggestion is surfaced until the cooldown elapses

#### Scenario: Failed comparison clears the state

- **WHEN** a comparison request fails
- **THEN** the attempt ends without surfacing a suggestion and the monitor retries subject to the interval and cooldown

### Requirement: Reroute state is observable

The system SHALL expose reroute and faster-route state so the UI can indicate progress and offer a choice. The navigation store's rerouting flag SHALL be set and cleared around automatic deviation reroutes, and candidate faster routes SHALL be exposed as a suggestion the user can accept or dismiss.

#### Scenario: Flag set during automatic reroute

- **WHEN** an automatic deviation reroute is in flight
- **THEN** `navigationStore.isRerouting` is true

#### Scenario: Flag cleared after reroute

- **WHEN** the reroute completes or fails
- **THEN** `navigationStore.isRerouting` is false

#### Scenario: Suggestion is observable

- **WHEN** a faster candidate is found
- **THEN** the navigation store exposes a suggestion carrying the candidate route and the seconds saved
