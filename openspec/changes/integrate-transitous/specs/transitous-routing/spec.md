## ADDED Requirements

### Requirement: Journey planning via MOTIS /trip endpoint

The system SHALL implement journey planning through Transitous by calling the MOTIS `POST /trip` endpoint with origin and destination coordinates, departure time, and count of desired results. The response SHALL be mapped to the existing `OtpItinerary[]` model.

#### Scenario: Transitous trip plan returns itineraries

- **WHEN** `planTransitTrip` is called with origin in central London and destination in Canary Wharf
- **THEN** at least one itinerary SHALL be returned
- **THEN** each itinerary SHALL contain legs with mode, route info, and geometry

#### Scenario: Transitous trip plan maps to OtpItinerary correctly

- **WHEN** Transitous returns a trip with one transit leg and one walk leg
- **THEN** the `OtpItinerary` SHALL have `legs[0]` with mode `SUBWAY` or `RAIL`
- **THEN** `legs[0].legGeometry.points` SHALL contain an encoded polyline
- **THEN** `legs[0].from` and `legs[0].to` SHALL have `name`, `lat`, `lon`

#### Scenario: Transitous unavailable falls back to OTP

- **WHEN** the Transitous `/trip` endpoint returns a non-2xx response or times out
- **THEN** the system SHALL fall back to the existing OTP routing path
- **THEN** a warning SHALL be logged to the console

### Requirement: MOTIS leg mode mapping

The system SHALL map MOTIS leg modes (walk, transit, bicycle, car, etc.) to Polaris `LegMode` values. MOTIS `transit` legs SHALL further map the transit route type to `TransitMode` (SUBWAY, RAIL, TRAM, etc.).

#### Scenario: MOTIS walk leg mapped to WALK

- **WHEN** a MOTIS leg has mode "walk"
- **THEN** the `OtpItinerary` leg SHALL have mode `WALK`

#### Scenario: MOTIS transit leg with subway route mapped correctly

- **WHEN** a MOTIS transit leg has a route with type "subway"
- **THEN** the `OtpItinerary` leg SHALL have mode `SUBWAY`
