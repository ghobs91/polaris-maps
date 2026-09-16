## ADDED Requirements

### Requirement: Compass control

The map SHALL show a compass whenever the map bearing is not north-up. Tapping the compass SHALL return the camera to north-up and reset pitch to top-down.

#### Scenario: Compass appears when rotated

- **WHEN** the user rotates the map away from north-up
- **THEN** the compass control becomes visible and indicates the map heading

#### Scenario: Compass resets orientation

- **WHEN** the user taps the compass while the map is rotated or tilted
- **THEN** the camera animates back to north-up heading and zero pitch

### Requirement: Scale bar

The map SHALL display a scale bar showing the ground distance represented by a fixed screen length at the current latitude and zoom.

#### Scenario: Scale bar reflects zoom

- **WHEN** the user zooms in or out
- **THEN** the scale bar updates to show the correct ground distance for the current latitude and zoom

### Requirement: Heading-aware location puck

When not in navigation mode, the location indicator SHALL indicate the device's heading when heading data is available.

#### Scenario: Device heading available

- **WHEN** the user is viewing the map with location enabled and heading data is available
- **THEN** the location indicator shows the device heading rather than a fixed orientation

#### Scenario: Heading unavailable

- **WHEN** heading data is not available
- **THEN** the location indicator falls back to a non-directional position dot without error

### Requirement: Rotate and pitch affordances

The map SHALL provide discoverable controls to reset rotation and to toggle or set map pitch between a flat top-down view and a tilted view.

#### Scenario: Toggle 3D pitch

- **WHEN** the user activates the pitch affordance
- **THEN** the camera animates between the flat and tilted pitch values and the control reflects the current state

#### Scenario: Reset rotation

- **WHEN** the user activates the rotation reset affordance while rotated
- **THEN** the map returns to north-up

### Requirement: Terrain map style with free DEM hillshade

Selecting the Terrain map type SHALL render a terrain style that includes hillshade derived from a free and openly licensed digital elevation model, in both light and dark themes.

#### Scenario: Select Terrain

- **WHEN** the user selects Terrain in the map-type selector
- **THEN** the map renders the base style plus hillshade and the selector reflects Terrain as selected

#### Scenario: Terrain in dark theme

- **WHEN** the active theme is dark and Terrain is selected
- **THEN** the terrain style uses a dark-appropriate hillshade and base style

#### Scenario: Terrain degrades gracefully offline

- **WHEN** the device is offline or on a weak link and Terrain is selected
- **THEN** the map still renders a usable base style instead of stalling on the DEM source

### Requirement: Map chrome does not degrade interaction

Map chrome controls SHALL respect safe-area insets, MUST NOT block map pan or zoom gestures outside the controls themselves, and SHALL update only in response to region events rather than per animation frame.

#### Scenario: Gestures around chrome

- **WHEN** the user pans or zooms the map near a chrome control
- **THEN** the gesture is handled by the map and is not intercepted by the control's container
