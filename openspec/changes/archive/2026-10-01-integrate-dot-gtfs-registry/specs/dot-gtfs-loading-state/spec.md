## ADDED Requirements

### Requirement: GTFS loading indicator

The transit store SHALL expose `gtfsLoadingAgency: string | null` while a GTFS feed is downloading and parsing, surfaced as a non-blocking banner that auto-dismisses after 15 seconds.

#### Scenario: Banner appears while loading

- **WHEN** a GTFS feed download starts
- **THEN** `gtfsLoadingAgency` SHALL be set to the agency label
- **THEN** the transit loading banner SHALL show "Loading transit data from <agency>…"

#### Scenario: Banner auto-dismisses

- **WHEN** the loading indicator has been shown for 15 seconds without being cleared
- **THEN** `gtfsLoadingAgency` SHALL be reset to null and the banner hidden

#### Scenario: New load replaces the pending dismissal

- **WHEN** a second feed starts loading before the first banner's timeout fires
- **THEN** the pending dismissal SHALL be cancelled and the banner SHALL reflect the new agency
