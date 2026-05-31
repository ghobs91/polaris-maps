## ADDED Requirements

### Requirement: Transitous global endpoint registration

The system SHALL register a Transitous endpoint in `OTP_ENDPOINTS` with `apiStyle: "transitous-v1"`, a worldwide bounding box `[-90, -180, 90, 180]`, and `url: "https://api.transitous.org/api"`. The endpoint SHALL be placed after all city-specific endpoints in the registry so that `findEndpointForCoords` only returns Transitous when no city-specific endpoint matches.

#### Scenario: Transitous matched as fallback for uncovered city

- **WHEN** `findEndpointForCoords` is called with coordinates in Denver (lat=39.74, lon=-104.99)
- **THEN** no city-specific endpoint SHALL match
- **THEN** the Transitous endpoint SHALL be returned as the last match

#### Scenario: City-specific endpoint takes priority over Transitous

- **WHEN** `findEndpointForCoords` is called with coordinates in Chicago (lat=41.88, lon=-87.63)
- **THEN** the CTA endpoint SHALL be returned (bbox matches before the global bbox)
- **THEN** the Transitous endpoint SHALL NOT be reached

### Requirement: Configurable Transitous base URL

The system SHALL support an `EXPO_PUBLIC_TRANSITOUS_BASE_URL` environment variable for the MOTIS API base URL, defaulting to `https://api.transitous.org/api`. This SHALL allow self-hosted instances without code changes.

#### Scenario: Default URL used when env var not set

- **WHEN** `EXPO_PUBLIC_TRANSITOUS_BASE_URL` is not configured
- **THEN** all Transitous API requests SHALL target `https://api.transitous.org/api`

#### Scenario: Custom URL used when env var is set

- **WHEN** `EXPO_PUBLIC_TRANSITOUS_BASE_URL` is set to a custom value
- **THEN** all Transitous API requests SHALL target the custom URL

### Requirement: Transitous dispatch in fetchTransitLines

The `tryFetchViaOtp` function SHALL recognize `apiStyle: "transitous-v1"` and return `null` to signal that line geometry will be provided by the MapLibre tile source rather than JS-side fetchers.

#### Scenario: Transitous style skips JS line fetching

- **WHEN** `tryFetchViaOtp` encounters an endpoint with `apiStyle === "transitous-v1"`
- **THEN** it SHALL return `null` immediately
- **THEN** the Overpass fallback SHALL NOT be invoked (tiles handle rendering)
