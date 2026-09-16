## ADDED Requirements

### Requirement: First launch routes through onboarding before the map

On the first launch after install, or after a consent-version change, the app SHALL present the onboarding consent flow before the interactive map is usable. On every subsequent launch with a completed consent record at the current version, the app MUST skip onboarding and open the map directly.

#### Scenario: First launch

- **WHEN** the app launches and no consent record exists in on-device storage
- **THEN** the onboarding flow is shown before the map and the map does not become the initial interactive surface

#### Scenario: Returning launch

- **WHEN** the app launches and a completed consent record matching the current consent version exists
- **THEN** onboarding is skipped and the map opens directly

### Requirement: Granular consent choices are collected and applied

The onboarding flow SHALL collect independent choices for location, traffic telemetry, POI contributions, and imagery sharing, and SHALL apply them through the consent service so they persist and are reflected in the settings store. Every choice MUST be independently togglable, MUST default to off until the user opts in, and MUST NOT be inferred from an OS permission grant.

#### Scenario: User opts in to a subset

- **WHEN** the user enables traffic telemetry, leaves the other three choices off, and completes the flow
- **THEN** the four choices are persisted, traffic telemetry is enabled, the other three remain disabled, and the current consent version is recorded

#### Scenario: Defaults are privacy-preserving

- **WHEN** the consent step is first displayed
- **THEN** every consent toggle is off until the user explicitly turns it on

### Requirement: Telemetry collectors do not run without consent

Traffic-probe collection and imagery sharing/upload MUST NOT start or continue unless the corresponding consent choice is enabled and consent is current. The app MUST stop a collector when its consent choice is turned off.

#### Scenario: Telemetry declined

- **WHEN** the user declines traffic telemetry and completes onboarding
- **THEN** no traffic probes are collected or published

#### Scenario: Imagery declined

- **WHEN** the user declines imagery sharing and completes onboarding
- **THEN** captured imagery is not uploaded or published to peers

#### Scenario: Consent revoked at runtime

- **WHEN** the user turns off traffic telemetry in Settings while probe collection is active
- **THEN** the collector stops and no further probes are published

### Requirement: Consent can be reviewed and changed in Settings

Settings SHALL provide a granular consent section that reflects the current choices and lets the user change any choice at any time. Changes MUST take effect immediately and MUST persist across launches.

#### Scenario: Change a choice in Settings

- **WHEN** the user opens Settings and disables POI contributions
- **THEN** the choice persists, is reflected in the settings store, and POI contribution actions are gated accordingly

#### Scenario: Settings reflects onboarding choices

- **WHEN** the user completes onboarding with imagery sharing enabled and later opens Settings
- **THEN** the imagery sharing control is shown as enabled

### Requirement: Consent version changes trigger re-consent

The consent record SHALL be versioned. When the stored version does not match the current consent version, the app MUST present the consent flow again before resuming normal use, and MUST update the stored version only after the user completes the flow.

#### Scenario: Version change

- **WHEN** the app launches with a stored consent version older than the current consent version
- **THEN** the consent flow is presented again and the stored version is updated only after the user completes it

#### Scenario: Same version

- **WHEN** the app launches with a stored consent version equal to the current version
- **THEN** no re-consent is presented

### Requirement: Declining consent still yields a usable app

Declining any or all consent choices MUST NOT block basic app use. The user SHALL still be able to view the map, browse and download offline regions, search, and navigate using on-device or offline data. Onboarding MUST NOT require network access to complete.

#### Scenario: All choices declined

- **WHEN** the user turns off every consent toggle, skips region download, and completes onboarding
- **THEN** the map and offline region browsing remain usable, and no dead-end prevents further use

#### Scenario: Onboarding completes offline

- **WHEN** the device has no network connectivity
- **THEN** the onboarding flow can be completed without a network request

### Requirement: OS permissions are requested just-in-time

The app SHALL request OS-level permissions only when the corresponding functionality is first used, with an explanation, and MUST NOT request permissions for functionality the user has opted out of. Declining an OS permission MUST NOT be treated as consent, and granting one MUST NOT enable a declined consent choice.

#### Scenario: Location permission at point of use

- **WHEN** the user starts navigation or requests their location without foreground location permission
- **THEN** the app requests foreground location at that moment with an explanation

#### Scenario: Opted-out functionality does not request permission

- **WHEN** the user has declined imagery sharing
- **THEN** the app does not request camera or photo permissions for imagery contribution
