## ADDED Requirements

### Requirement: Search filter controls

The system SHALL expose search filters for open now, minimum rating, maximum price, maximum distance, and category. Filters SHALL be reachable from the search tab and from the floating map search panel, and the active filter state SHALL be visible while results are shown.

#### Scenario: User applies the open-now filter

- **WHEN** the user enables the open-now filter
- **THEN** results whose parseable hours prove them closed SHALL be removed from the list
- **AND** the filter SHALL be visibly indicated as active

#### Scenario: User applies a rating and price filter

- **WHEN** the user sets a minimum rating and a maximum price level
- **THEN** only places meeting both constraints SHALL remain
- **AND** places missing rating or price data SHALL NOT be removed by that constraint alone

#### Scenario: Filters are available from the map panel

- **WHEN** the user opens filters from the floating search panel
- **THEN** the same filter set SHALL be available as in the search tab

### Requirement: Result sorting control

The system SHALL provide a sort control with relevance (default), distance, rating, and price options. Changing the sort SHALL reorder the currently displayed results without discarding them.

#### Scenario: Sort by distance

- **WHEN** the user selects distance sort
- **THEN** results SHALL be ordered by ascending distance from the current reference point
- **AND** results without coordinates SHALL be placed after coordinate-bearing results

#### Scenario: Return to relevance

- **WHEN** the user selects relevance sort
- **THEN** results SHALL be ordered by the ranker's relevance score, ties broken by distance

### Requirement: Filters and sorting apply to the staged ranking pipeline

The system SHALL apply filters and sorting to every staged emission from the search pipeline so that filtered and sorted results remain consistent as later stages arrive. Filtering SHALL NOT modify the relevance score of surviving results.

#### Scenario: Later stage respects active filters

- **WHEN** a filter is active and a later search stage emits new results
- **THEN** the new results SHALL be filtered with the same predicate before display
- **AND** results already displayed SHALL NOT reappear unfiltered

#### Scenario: Score remains honest after filtering

- **WHEN** a result survives an active filter
- **THEN** its displayed match value SHALL be unchanged by the filter

#### Scenario: Filter change is applied locally first

- **WHEN** the user toggles a non-category filter on an existing result set
- **THEN** the system SHALL re-apply the filter to accumulated results without issuing a new network search

### Requirement: Filters compose with natural-language intent

The system SHALL treat intent parsed from the query text as default filter values that only apply until the user sets a filter explicitly. Effective constraints SHALL be the intersection of explicit user filters and parsed intent and SHALL never widen the result set beyond either source.

#### Scenario: Query intent seeds a filter

- **WHEN** the user types "open now coffee" without touching the filter UI
- **THEN** the open-now filter SHALL be treated as active

#### Scenario: Explicit selection overrides intent

- **WHEN** the user types "open now coffee" and then turns the open-now filter off
- **THEN** closed places SHALL be eligible for display for the rest of the session

#### Scenario: Constraints only narrow

- **WHEN** a category filter and a category inferred from intent differ
- **THEN** the displayed results SHALL satisfy both categories and SHALL NOT include places matching only one

### Requirement: Session-scoped filter persistence

The system SHALL persist the active filters and sort selection for the duration of the app session and SHALL restore them when the user returns to search. The state SHALL NOT be persisted across app restarts unless the user opts in.

#### Scenario: Navigating away preserves filters

- **WHEN** the user applies filters, navigates to the map, and returns to search
- **THEN** the filters and sort selection SHALL still be applied

#### Scenario: Restart clears filters by default

- **WHEN** the app is restarted
- **THEN** filters and sort SHALL return to their defaults unless the user has opted into persistence

### Requirement: Empty filtered results guidance

When active filters remove every result, the system SHALL show an actionable empty state that explains what was filtered and offers to relax the constraints.

#### Scenario: All results filtered out

- **WHEN** active filters exclude every result
- **THEN** the system SHALL display an empty state naming the active constraints
- **AND** the empty state SHALL offer a control to clear filters

### Requirement: Rich result rows

Each search result row SHALL display, when the data is available, a category icon, a licensed thumbnail, the community rating, an open/closed badge, a price level, and the distance from the reference point, in addition to the place name and locality. Missing fields SHALL be omitted without leaving broken placeholders.

#### Scenario: Fully enriched row

- **WHEN** a result has category, media, rating, hours, price, and coordinates
- **THEN** the row SHALL render all of those elements

#### Scenario: Sparse row degrades gracefully

- **WHEN** a result has only a name and locality
- **THEN** the row SHALL render name and locality without empty badges or broken images

### Requirement: Result pagination

The system SHALL support incremental loading of additional search results beyond the initial page. Loading more SHALL append results in the active sort order and SHALL NOT introduce duplicates of already displayed results.

#### Scenario: Loading a second page

- **WHEN** the user scrolls to the end of the first page
- **THEN** the next set of results SHALL be appended in the active sort order

#### Scenario: No duplicate across pages

- **WHEN** pagination occurs after a new staged emission reordered the results
- **THEN** every result SHALL appear at most once across all loaded pages

### Requirement: Voice search in the floating map panel

The floating map search panel SHALL provide voice search that fills the search input with a recognized transcript, and SHALL fall back to the keyboard when speech recognition is unavailable or permission is denied. Microphone permission SHALL be requested just-in-time with an explanation.

#### Scenario: Successful dictation

- **WHEN** the user taps the microphone and speaks a place name
- **THEN** the recognized transcript SHALL populate the search input and trigger a search

#### Scenario: Permission denied degrades to keyboard

- **WHEN** the user denies microphone permission
- **THEN** the voice control SHALL stop prompting and text entry SHALL remain fully usable
