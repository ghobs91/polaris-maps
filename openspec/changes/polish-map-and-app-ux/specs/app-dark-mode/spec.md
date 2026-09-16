## ADDED Requirements

### Requirement: In-app theme controls all user-facing surfaces

Every user-facing screen and component SHALL derive its colors from the in-app theme value exposed by ThemeContext, so selecting System, Light, or Dark updates all surfaces consistently.

#### Scenario: Switch to Dark mode

- **WHEN** the user selects Dark in Settings while the app is running
- **THEN** the map tab, place detail, offline regions, search results, settings, and common chrome all render with dark colors without an app restart

#### Scenario: Switch to Light mode

- **WHEN** the user selects Light in Settings while the OS is in dark mode
- **THEN** all user-facing surfaces render with light colors

### Requirement: Gated and modal surfaces use the in-app theme

Surfaces that gate or interrupt navigation, including RegionGate and modal pickers, SHALL use ThemeContext values and MUST NOT call `useColorScheme()` directly, so an explicit Light or Dark choice overrides the operating system scheme.

#### Scenario: Manual Light with OS dark

- **WHEN** the OS is in dark mode and the in-app theme is set to Light
- **THEN** RegionGate and modal pickers render in light colors

#### Scenario: System mode follows the OS

- **WHEN** the in-app theme is System and the OS scheme changes
- **THEN** gated and modal surfaces update to match the OS scheme

### Requirement: No hard-coded light colors in user-facing code

User-facing components MUST NOT hard-code light-only background or text colors. Color values SHALL come from the theme palette.

#### Scenario: Hard-coded background removed

- **WHEN** the map tab surface is inspected in dark mode
- **THEN** its background comes from the theme palette and no literal light background color remains

### Requirement: Map style follows the theme

The map's basemap style, including its offline and slow-link compatibility fallbacks, SHALL follow the active theme so the map is not a light surface inside a dark app.

#### Scenario: Dark theme map

- **WHEN** the active theme is dark
- **THEN** the map renders the dark basemap and dark fallback styles

### Requirement: Theme choice persists across launches

The selected theme mode SHALL be persisted and re-applied on the next launch.

#### Scenario: Relaunch after choosing Dark

- **WHEN** the user selects Dark, force-quits, and relaunches the app
- **THEN** the app opens in dark mode without flashing a light surface
