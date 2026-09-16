## ADDED Requirements

### Requirement: Advance-distance announcement ladder

The app SHALL announce an upcoming maneuver at multiple distances before the maneuver is reached, not only when the maneuver becomes current.

#### Scenario: Band announcement

- **WHEN** the user is within an announcement band distance of the next maneuver
- **AND** that band has not yet been announced for that maneuver
- **THEN** the app SHALL speak the maneuver instruction once for that band

#### Scenario: No duplicate announcements

- **WHEN** a maneuver's instruction has already been announced for a band
- **AND** the user remains within that band
- **THEN** the app SHALL NOT announce that band again for the same maneuver

#### Scenario: Bands skipped when starting late

- **WHEN** guidance starts already within a shorter announcement band of a maneuver
- **THEN** the app SHALL announce the applicable shorter band
- **AND** the app SHALL NOT announce longer bands that were already passed

#### Scenario: Ladder resets after reroute

- **WHEN** the route is recomputed and the maneuvers change
- **THEN** the app SHALL reset announcement state and apply the ladder to the new route's maneuvers

### Requirement: Starting navigation prompt

The app SHALL speak a starting-navigation prompt when guidance begins.

#### Scenario: Prompt on navigation start

- **WHEN** navigation starts
- **THEN** the app SHALL speak a starting-navigation prompt once

### Requirement: Spoken reroute and off-route notifications

The app SHALL speak when the user goes off route and again when a reroute completes.

#### Scenario: Off-route announcement

- **WHEN** the user is detected as off the active route
- **THEN** the app SHALL speak an off-route notification once per off-route event

#### Scenario: Reroute-complete announcement

- **WHEN** a reroute completes and guidance resumes on the new route
- **THEN** the app SHALL speak a reroute-complete notification

### Requirement: In-navigation mute and repeat

The app SHALL provide mute and repeat controls during active navigation.

#### Scenario: Mute suppresses prompts

- **WHEN** the user mutes guidance during navigation
- **THEN** the app SHALL suppress spoken prompts
- **AND** the app SHALL show a muted state in the navigation UI
- **AND** the app SHALL NOT change the global voice-guidance setting

#### Scenario: Repeat replays the current prompt

- **WHEN** the user activates repeat during navigation
- **THEN** the app SHALL speak the current maneuver instruction again, even if it was recently spoken

### Requirement: Voice prompts play while the screen is locked

The app SHALL keep voice guidance audible while the device screen is locked or the app is backgrounded during active navigation.

#### Scenario: Prompt while locked

- **WHEN** navigation is active and the device screen locks
- **THEN** upcoming voice prompts SHALL still play through the device speaker

#### Scenario: Audio session released after navigation

- **WHEN** navigation ends
- **THEN** the app SHALL release the background audio session

### Requirement: Device TTS is the synthesis engine

The app SHALL synthesize voice guidance using the on-device text-to-speech engine and SHALL NOT depend on a network or paid voice service.

#### Scenario: Offline guidance

- **WHEN** the device has no network connectivity
- **THEN** voice guidance SHALL still be produced by the device TTS engine
