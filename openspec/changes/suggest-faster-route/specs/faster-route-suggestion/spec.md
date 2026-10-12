## ADDED Requirements

### Requirement: Traffic-aware candidate comparison

While navigation is active, the system SHALL compute candidate routes from the user's latest tracked position to the destination, preserving any remaining waypoints and the user's route preferences, and SHALL account for live traffic when scoring them.

#### Scenario: Candidates preserve waypoints and preferences

- **WHEN** the active route has remaining waypoints or enabled avoid-tolls, avoid-highways, or avoid-ferries preferences
- **THEN** every candidate is computed with the same ordered waypoints and the same preferences

#### Scenario: Live traffic is applied before scoring

- **WHEN** live traffic speeds are available
- **THEN** the routing engine is given those speeds before candidate routes are computed, and candidate durations are traffic-adjusted when segment coverage is sufficient

#### Scenario: No GPS fix is available

- **WHEN** no tracked position is available
- **THEN** the comparison is deferred rather than issued from a placeholder origin

#### Scenario: Candidate computation degrades gracefully

- **WHEN** the engine or platform cannot supply alternatives (offline, MapKit, or via points present)
- **THEN** the system evaluates the single computed route rather than failing

### Requirement: Faster-route suggestion presentation

The system SHALL present a dismissible suggestion during navigation when a candidate is faster by at least the minimum saving threshold, showing how much time it saves.

#### Scenario: Suggestion shown for a significant saving

- **WHEN** the best candidate saves at least the minimum threshold versus the active route's remaining traffic-adjusted time
- **THEN** a suggestion is presented showing the saved time

#### Scenario: No suggestion for a marginal saving

- **WHEN** the best candidate saves less than the minimum threshold
- **THEN** no suggestion is presented

#### Scenario: Suggestion does not interrupt guidance

- **WHEN** a suggestion is presented
- **THEN** turn guidance and voice continue on the active route unchanged

### Requirement: Suggestion acceptance and dismissal

The system SHALL let the user accept or dismiss a faster-route suggestion, and SHALL NOT change the active route unless the user accepts.

#### Scenario: Accept adopts the candidate

- **WHEN** the user accepts the suggestion
- **THEN** the candidate becomes the active route and the suggestion is cleared

#### Scenario: Dismiss keeps the active route

- **WHEN** the user dismisses the suggestion
- **THEN** the active route is unchanged and the suggestion is cleared

#### Scenario: Suggestion cleared when navigation ends

- **WHEN** navigation ends or a route is replaced for another reason
- **THEN** any outstanding suggestion is cleared
