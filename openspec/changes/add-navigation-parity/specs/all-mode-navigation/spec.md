## ADDED Requirements

### Requirement: Mode selector offers guided walk and bicycle

The transport mode selector SHALL offer walking and bicycling as selectable modes where the routing costing and data are available.

#### Scenario: Bicycle mode available

- **WHEN** the routing engine supports the bicycle costing for the requested route
- **THEN** the mode selector SHALL offer a bicycle option
- **AND** selecting it SHALL compute a bicycle route

#### Scenario: Walking mode starts guidance

- **WHEN** the user selects walk mode and starts navigation
- **THEN** the app SHALL compute a pedestrian route and begin turn-by-turn guidance

### Requirement: Walking and cycling guidance reuse the guidance UI

The app SHALL provide turn-by-turn guidance for walking and bicycling using the same guidance shell as driving.

#### Scenario: Walk guidance

- **WHEN** the active costing is pedestrian
- **THEN** the app SHALL show turn-by-turn maneuvers, remaining distance, ETA, arrival handling, and voice guidance using the guidance UI

#### Scenario: Bicycle guidance

- **WHEN** the active costing is bicycle
- **THEN** the app SHALL show turn-by-turn maneuvers, remaining distance, ETA, arrival handling, and voice guidance using the guidance UI

### Requirement: Mode-appropriate navigation UI

The app SHALL hide automotive-only navigation widgets for non-automotive modes.

#### Scenario: No lane guidance or speed limit for walking or cycling

- **WHEN** the active costing is pedestrian or bicycle
- **THEN** the app SHALL NOT show lane guidance
- **AND** the app SHALL NOT show the speed-limit sign or current-speed HUD

#### Scenario: Driving keeps automotive widgets

- **WHEN** the active costing is automobile
- **THEN** the app SHALL show automotive widgets when the route data provides them

### Requirement: Transit step-through guidance

The app SHALL provide step-through guidance for a selected transit itinerary.

#### Scenario: Stepping through a transit itinerary

- **WHEN** navigation starts on a selected transit itinerary
- **THEN** the app SHALL present the itinerary steps in order
- **AND** the app SHALL advance through the steps as the user proceeds

#### Scenario: Transit uses transit-appropriate presentation

- **WHEN** the active mode is transit
- **THEN** the app SHALL NOT present road lane guidance or speed-limit widgets
- **AND** the app SHALL present transit legs and alighting information
