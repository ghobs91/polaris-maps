## ADDED Requirements

### Requirement: Units preference is configurable in Settings

Settings SHALL provide a units control offering metric (metres, kilometres, km/h) and imperial (feet, miles, mph) options. The selection MUST persist across launches and MUST be the single source of truth for unit display, not the device locale.

#### Scenario: Switch to metric

- **WHEN** the user selects metric in Settings
- **THEN** the preference persists and subsequent distance and speed displays use metric units

#### Scenario: Preference overrides device locale

- **WHEN** the device locale implies imperial but the user selects metric
- **THEN** distance and speed displays use metric units

### Requirement: Units apply consistently to distance, ETA, and speed displays

The units preference SHALL apply to all user-facing distance, speed, and route-summary displays, including turn-by-turn distances, ETA and remaining distance, speed-limit signs, route-preview summaries, and CarPlay output. These surfaces MUST NOT use hardcoded or locale-only unit formatting.

#### Scenario: Speed limit respects units

- **WHEN** the units preference is metric and a speed limit is displayed
- **THEN** the speed-limit sign shows km/h

#### Scenario: Turn and ETA distances respect units

- **WHEN** the units preference is metric during navigation
- **THEN** next-turn distance and remaining-distance/ETA displays show metres or kilometres

#### Scenario: CarPlay respects units

- **WHEN** a route summary or speed limit is mirrored to CarPlay
- **THEN** the units match the in-app preference

### Requirement: Map style and layer selection persist across launches

The selected map style (default, satellite, or terrain) and layer toggles (at least traffic) SHALL persist in on-device storage and be restored when the app next launches.

#### Scenario: Style persists

- **WHEN** the user selects the satellite style and relaunches the app
- **THEN** the map opens with the satellite style selected

#### Scenario: Layer toggle persists

- **WHEN** the user enables the traffic layer and relaunches the app
- **THEN** the traffic layer is still enabled

### Requirement: Gated surfaces follow the in-app theme

Surfaces shown before or over the map, including the region download gate and its region picker, SHALL derive their colors from the in-app theme setting and MUST NOT depend solely on the OS color scheme.

#### Scenario: In-app theme differs from the OS

- **WHEN** the user selects the dark in-app theme while the OS is in light mode and the region gate is shown
- **THEN** the gate renders with the dark in-app theme

#### Scenario: System theme selected

- **WHEN** the in-app theme is set to System
- **THEN** gated surfaces follow the OS color scheme
