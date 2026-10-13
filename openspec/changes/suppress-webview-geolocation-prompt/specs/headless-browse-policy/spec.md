## ADDED Requirements

### Requirement: No platform permission prompts from headless browsing

On-device headless browsing SHALL NOT cause the platform to prompt the user for permissions on behalf of a third-party page. Hidden WebViews SHALL present a denied geolocation state to page scripts before the page's own scripts run — both by neutralizing the page-visible Geolocation API and, where the platform exposes a decision hook, by answering the platform's permission request with a denial.

#### Scenario: Page requests geolocation during a scrape

- **WHEN** a loaded provider or venue page calls `navigator.geolocation`, or queries the geolocation permission state
- **THEN** the request fails as denied and no system permission prompt is shown
- **AND** the page's location request never reaches the platform

#### Scenario: Platform asks the host app for a geolocation decision

- **WHEN** the platform WebView asks the app whether a page's origin may use geolocation
- **THEN** the app denies the request without user interaction

### Requirement: Denying access is not circumvention

Presenting a denied geolocation state SHALL NOT be treated as prohibited circumvention. The prohibition on forging permission state targets fabricating a **granted** or human-like state to evade anti-bot systems; reducing the app's own access to device location is equivalent to the user choosing "Don't Allow" and SHALL remain permitted.

#### Scenario: Guard reviewed against the circumvention clause

- **WHEN** the geolocation guard is evaluated against the bounded-circumvention prohibition
- **THEN** it is allowed because it removes access rather than fabricating a granted or human-like state
