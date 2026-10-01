## ADDED Requirements

### Requirement: Spatial feed lookup

The system SHALL provide `lookupDotGtfsFeeds(lat, lng, radiusDeg, maxFeeds)` that returns the DOT GTFS feeds covering an area, sorted by UZA population (largest metros first), deduplicated by feed URL, and excluding entries without a download URL.

#### Scenario: Seattle lookup

- **WHEN** the lookup is called for Seattle coordinates
- **THEN** it SHALL return the Seattle-area agencies (e.g. King County, Central Puget Sound Regional Transit Authority)
- **THEN** every returned entry SHALL carry a usable feed URL

#### Scenario: Empty ocean lookup

- **WHEN** the lookup is called for a coordinate far from any US agency
- **THEN** it SHALL return an empty list

#### Scenario: Feed lookup by NTD id

- **WHEN** `getDotGtfsFeedByNtdId` is called with a known NTD id
- **THEN** it SHALL return the matching feed entry
