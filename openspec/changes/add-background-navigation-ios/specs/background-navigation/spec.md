## ADDED Requirements

### Requirement: Navigation continues while app is backgrounded or locked

While turn-by-turn navigation is active on iOS, the system SHALL continue processing location updates and maintaining guidance state (current position, maneuver step, ETA/remaining distance, off-route detection with rerouting, voice prompts) when the app moves to the background or the device is locked.

#### Scenario: User locks phone mid-route

- **WHEN** navigation is active and the user presses the lock button
- **THEN** GPS fixes continue to be processed, guidance state continues to advance, and the Live Activity continues to update until navigation ends

#### Scenario: User switches to another app mid-route

- **WHEN** navigation is active and the user backgrounds Polaris Maps to another app
- **THEN** guidance state continues to advance and returning to the app shows current position and step without gaps or stale data

### Requirement: Background session lifecycle tied to navigation state

The system SHALL start its background-capable location session when navigation starts and SHALL stop it when navigation ends (user cancel, route completion, or reroute failure leading to stop). The system MUST NOT run background location sessions outside active navigation.

#### Scenario: Session stops when navigation ends

- **WHEN** the user cancels navigation or arrives at the destination
- **THEN** the background location session is stopped and no further background location processing occurs

#### Scenario: No zombie sessions after relaunch

- **WHEN** the OS relaunches the app to deliver a background location event but navigation is not active
- **THEN** the task handler exits without starting tracking

### Requirement: Shared tracking pipeline for foreground and background

The GPS-processing pipeline (snap-to-route, dead-reckoning anchor update with no-backwards-jump rule, off-route detection threshold and counter, reroute triggering, maneuver step advancement against beginShapeIndex, ETA/remaining-distance computation) SHALL exist as a single shared module invoked by both foreground and background location delivery, so behavior is identical in both modes.

#### Scenario: Step advances identically from background fix

- **WHEN** a GPS fix processed in the background crosses the next maneuver's beginShapeIndex
- **THEN** the current step index advances exactly as it would for a foreground fix

#### Scenario: Off-route reroute fires from background fix

- **WHEN** consecutive background fixes exceed the off-route threshold beyond the retry counter limit
- **THEN** a reroute is requested against the original destination and the active route is replaced on success

### Requirement: Live position readable by UI from store

Live navigation position, bearing, and distance-to-turn SHALL be published to a subscribable store that the navigation screen reads, decoupled from component-local React state, so values written while the UI is not rendering are present when it resumes.

#### Scenario: Screen reflects position after unlock

- **WHEN** the user unlocks the device during active navigation
- **THEN** the map shows the vehicle marker at the current interpolated position and bearing without waiting for the next GPS tick to resync

### Requirement: Background permission requested at navigation start with graceful fallback

The system SHALL check/request iOS background ("Always") location permission lazily at the moment navigation starts — preceded by an in-app explainer when the status is undetermined — rather than at app launch. If the user denies background permission, navigation SHALL proceed with the existing foreground-only tracking behavior.

#### Scenario: First navigation with undetermined background permission

- **WHEN** the user starts navigation without prior Always authorization
- **THEN** an explainer is shown followed by the OS permission prompt; on grant, the managed background session drives guidance; on denial, the foreground-only watcher drives guidance

#### Scenario: Previously denied background permission

- **WHEN** the user starts navigation having previously denied Always authorization
- **THEN** navigation proceeds immediately with foreground-only tracking and does not re-prompt

### Requirement: Background location indicator enabled

When the background location session runs under When-In-Use style authorization, the system SHALL enable iOS's background-location indicator so the user can see location use is ongoing.

#### Scenario: Blue indicator visible while backgrounded

- **WHEN** navigation is active and the app is backgrounded under When-In-Use authorization
- **THEN** the iOS status-bar/blue-pill background-location indicator is shown
