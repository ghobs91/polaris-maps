## ADDED Requirements

### Requirement: Build-time spatial index

The system SHALL process `src/services/transit/DOT_GTFS_Feeds_List.csv` at build time into a spatially-bucketed JSON index (`src/services/transit/dot-gtfs-index.json`) bundled with the app, containing every agency entry with coordinates and a GTFS download URL.

#### Scenario: Index generation

- **WHEN** the build-time script runs
- **THEN** it SHALL extract unique agency entries, resolve coordinates, group them into 0.1° spatial buckets, and deduplicate by NTD ID + mode preferring valid `https://` URLs
- **THEN** the output SHALL include a version, generation timestamp, bucket size, buckets, and entries

#### Scenario: Index bundles with the app

- **WHEN** the app starts
- **THEN** the index SHALL be loaded from the bundled JSON without a network request
- **THEN** `isDotGtfsAvailable()` SHALL report whether the index loaded
