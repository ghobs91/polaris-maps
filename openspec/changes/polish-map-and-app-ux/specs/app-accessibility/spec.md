## ADDED Requirements

### Requirement: Map controls expose accessibility metadata

All interactive map controls, including the layers, parking, locate buttons, and the new map chrome controls, SHALL expose an accessibility label, an accessibility role, and state where applicable, and SHALL provide a hit target of at least 44 by 44 points.

#### Scenario: VoiceOver focus on locate control

- **WHEN** VoiceOver focus lands on the locate control
- **THEN** it announces a descriptive label and a button role

#### Scenario: Layers control state

- **WHEN** the layers control is open or closed
- **THEN** its accessibility state is announced as expanded or collapsed

### Requirement: Pickers and selectors use accessible controls

Selection controls such as the theme picker and the map-type selector SHALL be implemented as accessible controls with a role and selected state, and MUST NOT rely on a bare text element with an on-press handler as the only affordance.

#### Scenario: VoiceOver on theme options

- **WHEN** VoiceOver focus moves across the theme options
- **THEN** each option announces its label, a button or radio role, and whether it is selected

#### Scenario: Activate an option accessibly

- **WHEN** the user activates a theme option using VoiceOver
- **THEN** the theme changes and the selected state is announced

### Requirement: Dynamic Type support without clipping

Text SHALL scale with the user's Dynamic Type setting without clipping or overlapping. Fixed-height text containers MUST use minimum heights or scrollable containers, and dense map-anchored overlays SHALL apply a defined maximum font-size multiplier while remaining legible.

#### Scenario: Largest accessibility text size

- **WHEN** the user sets the largest accessibility text size and opens a content screen
- **THEN** text scales up, the content remains readable, and no text is clipped or overlapped

#### Scenario: Dense map overlay at large text

- **WHEN** the user sets the largest accessibility text size and views the map
- **THEN** map-anchored labels scale up to the defined cap and remain legible without obscuring the map

### Requirement: VoiceOver-friendly map and marker summary

The map SHALL expose a summary describing its visible content, and POI markers and cluster markers SHALL each expose an individual label so a VoiceOver user can understand what is on screen.

#### Scenario: Map summary

- **WHEN** VoiceOver focuses the map
- **THEN** it announces a summary of the visible places, including how many clusters and individual places are shown

#### Scenario: Marker labels

- **WHEN** VoiceOver focus lands on a cluster marker
- **THEN** it announces the number of places in the cluster

#### Scenario: POI marker label

- **WHEN** VoiceOver focus lands on a POI marker
- **THEN** it announces the place name and category

### Requirement: Sufficient contrast in both themes

Text and essential iconography SHALL meet WCAG AA contrast against their backgrounds in both the light and dark themes.

#### Scenario: Dark theme contrast audit

- **WHEN** body and secondary text in the dark theme are measured against their backgrounds
- **THEN** the contrast ratio meets the AA threshold for the text size

#### Scenario: Light theme contrast audit

- **WHEN** body and secondary text in the light theme are measured against their backgrounds
- **THEN** the contrast ratio meets the AA threshold for the text size

### Requirement: Reduced motion preference is respected

When the operating system's Reduce Motion preference is enabled, the system SHALL suppress or shorten non-essential camera and sheet animations.

#### Scenario: Reduce Motion enabled

- **WHEN** Reduce Motion is enabled and the user opens a sheet or recenters the map
- **THEN** the animation is skipped or reduced rather than playing the full movement
