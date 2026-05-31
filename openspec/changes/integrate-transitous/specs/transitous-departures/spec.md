## ADDED Requirements

### Requirement: Departure data via MOTIS /stop_event endpoint

The system SHALL fetch real-time and scheduled departure data from the Transitous MOTIS `POST /stop_event` endpoint, given a station ID, latitude/longitude, and a time window. The response SHALL be mapped to the existing `StopDepartureInfo` model used by the transit stop card.

#### Scenario: Departures fetched for a London Tube station

- **WHEN** `fetchStopDepartures` is called for "Oxford Circus" station with lat=51.515, lon=-0.142
- **THEN** the system SHALL call `POST /stop_event` on the Transitous endpoint
- **THEN** a `StopDepartureInfo` SHALL be returned with departure entries for upcoming trains

#### Scenario: Departures include real-time delay data

- **WHEN** a MOTIS departure event includes real-time information (delay seconds)
- **THEN** the `Departure` SHALL have `isRealtime: true`
- **THEN** `minutesAway` SHALL reflect the adjusted real-time departure

#### Scenario: Departures include route color and mode

- **WHEN** a departure relates to a transit route
- **THEN** the `Departure` SHALL have `color`, `mode`, `routeName`, and `headsign` populated from the MOTIS response

### Requirement: Fallback to city-specific departure APIs

When Transitous is not available for a given stop or the `/stop_event` endpoint fails, the system SHALL fall back to the existing departure fetcher pipeline (city-specific APIs like MBTA V3, WMATA, or headway estimation).

#### Scenario: Transitous departure endpoint returns 503

- **WHEN** the Transitous `/stop_event` endpoint returns a non-2xx response
- **THEN** the system SHALL fall back to the existing departure fetcher for that region
- **THEN** a warning SHALL be logged

#### Scenario: City-specific API takes priority over Transitous

- **WHEN** a stop is in Boston (MBTA endpoint matches)
- **THEN** MBTA V3 departures SHALL be used (they include MBTA-specific prediction data)
- **THEN** Transitous SHALL NOT be called for departures
