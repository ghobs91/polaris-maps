## ADDED Requirements

### Requirement: Home-screen widget

The app SHALL provide an iOS home-screen widget that displays the user's saved places and, while navigation is active, the destination name and remaining time or ETA.

#### Scenario: Widget shows saved places

- **WHEN** the user has saved places and no navigation is active
- **THEN** the widget lists saved places

#### Scenario: Widget shows active navigation

- **WHEN** navigation is active
- **THEN** the widget shows the destination name and the remaining time or ETA

#### Scenario: Widget without saved places

- **WHEN** the user has no saved places and navigation is not active
- **THEN** the widget shows an empty state that invites the user to open the app to add places

### Requirement: Siri and App Intents can navigate home

The app SHALL expose an App Intent that starts navigation to the saved Home place, invocable through Siri and the Shortcuts app. When no Home place is set, the intent SHALL direct the user to open the app to set one instead of failing silently.

#### Scenario: Navigate home with Home set

- **WHEN** the user invokes the navigate-home intent and a Home place is saved
- **THEN** the app starts navigation to the Home place

#### Scenario: Navigate home with no Home set

- **WHEN** the user invokes the navigate-home intent without a saved Home place
- **THEN** the app opens to a screen where the user can set Home

### Requirement: Reuse existing navigation and place state

The widget and App Intents SHALL read the same navigation and place-list state used by the app and MUST NOT maintain a divergent copy of that data.

#### Scenario: Destination matches the app

- **WHEN** the app starts navigation to a destination
- **THEN** the widget and the navigate-home intent resolve destinations from the same state that the in-app navigation screen uses

### Requirement: Shared state consistent with Live Activities

The widget, App Intents, and Live Activities SHALL read from a single shared on-device state location so that the destination and ETA they display agree with each other.

#### Scenario: Live Activity and widget agree

- **WHEN** navigation is active and the ETA changes
- **THEN** the widget and the Live Activity show the same destination and a consistent remaining time

### Requirement: Device-only integration

The widget and App Intents MUST run entirely on-device and MUST NOT depend on a server-side service or a paid third-party dependency.

#### Scenario: No network dependency

- **WHEN** the device is offline while navigation is active
- **THEN** the widget and intents continue to display the last-known shared state without contacting a server

### Requirement: Native targets delivered through config plugins

Because regenerating the native project wipes `ios/`, the widget and App Intent targets, their sources, entitlements, and App Group configuration SHALL be installed by config plugins. These files MUST NOT be hand-edited in `ios/`.

#### Scenario: Clean prebuild regenerates targets

- **WHEN** the native project is regenerated with a clean prebuild
- **THEN** the widget and App Intent targets, App Group entitlement, and shared state container are present without manual steps

#### Scenario: Removing the integration

- **WHEN** the config plugin is removed and the native project is regenerated
- **THEN** the widget and App Intent targets are no longer part of the project
