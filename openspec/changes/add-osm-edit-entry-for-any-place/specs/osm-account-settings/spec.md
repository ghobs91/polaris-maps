## ADDED Requirements

### Requirement: OSM edit entry point resolves any place

The place card's OSM edit affordance SHALL be offered for every selected place, not only for places already rendered from OSM. A place that carries a genuine OSM node id SHALL be edited directly; any other place SHALL have its OSM element resolved by name and proximity before the editor opens, and SHALL report its state while resolving. Only a genuine OSM node id SHALL ever be passed to the node editor.

#### Scenario: Non-OSM place that is mapped as a node

- **WHEN** the user opens a place rendered from Overture, a saved list, or a search result and taps the edit affordance
- **THEN** the place's OSM node is resolved by name and proximity
- **AND** the editor opens on that node

#### Scenario: Non-OSM place that is not mapped

- **WHEN** no OSM element matches the place
- **THEN** an Overture-sourced place is offered for creation in the editor
- **AND** any other source is told the place is not mapped, without opening the editor

#### Scenario: Place mapped as a way or relation

- **WHEN** the place matches an OSM way or relation rather than a node
- **THEN** the user is told it is already mapped and cannot be edited in the app
- **AND** the editor is not opened for it

#### Scenario: Unauthenticated user

- **WHEN** the user taps the edit affordance without an OSM session
- **THEN** the OSM sign-in flow starts before any lookup, as the manual add flow does

#### Scenario: Lookup unavailable

- **WHEN** the OSM element lookup fails
- **THEN** the user is told OpenStreetMap could not be reached and no editor opens

### Requirement: POI id spaces are not conflated

Rendered POIs SHALL distinguish genuine OSM node ids from Nominatim `place_id`s and from Overpass way ids, so that neither is ever used as an OSM node id. Places rendered from Overpass SHALL record their element type, and places rendered from Nominatim SHALL record their source.

#### Scenario: Nominatim result is not treated as an OSM node

- **WHEN** a POI rendered from Nominatim is checked for editability
- **THEN** it is not treated as an OSM node and its `place_id` is never sent to the node editor

#### Scenario: Way-mapped place is not sent to the node editor

- **WHEN** a POI rendered from an Overpass way is checked for editability
- **THEN** it is not treated as an OSM node
- **AND** it is resolved like any other non-node place
