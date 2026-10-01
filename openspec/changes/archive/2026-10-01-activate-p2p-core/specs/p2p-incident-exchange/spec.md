## ADDED Requirements

### Requirement: Incident wire format

The system SHALL define a single incident message envelope that round-trips through the Bare worklet bridge AND the Nostr fallback, encoding the incident id, reporter public key, coordinates, geohash6, type, description, report time, expiry, and signature.

#### Scenario: Incident round-trips through the bridge

- **WHEN** an incident is encoded for the Hyperswarm bridge and decoded by the receiving side
- **THEN** every incident field matches the original value

#### Scenario: Unknown envelope is not treated as a probe

- **WHEN** the worklet or bridge receives an incident envelope
- **THEN** it is routed to the incident handler and does not produce a traffic probe

#### Scenario: Nostr incident uses a distinct ephemeral kind

- **WHEN** an incident is published over the Nostr fallback
- **THEN** it is sent as an ephemeral event with the geohash `g` tag and an `expiration` tag derived from the incident expiry

### Requirement: Incident broadcast on report

The system SHALL broadcast a signed incident when a report is submitted, using Hyperswarm when peer threshold is met and the Nostr fallback otherwise, and SHALL enqueue the incident for replay when no transport is available.

#### Scenario: Report broadcasts over Hyperswarm

- **WHEN** a user submits an incident report while the Hyperswarm worklet is started with enough peers
- **THEN** the signed incident is broadcast to peers

#### Scenario: Report broadcasts over Nostr fallback

- **WHEN** a user submits an incident report and `swarmPeerCount < MIN_PEER_THRESHOLD`
- **THEN** the signed incident is published to the Nostr relays

#### Scenario: Offline report is queued

- **WHEN** a user submits an incident report and no transport is available
- **THEN** the incident is added to the offline queue for later replay

### Requirement: Incident receive, verification, and retention

The system SHALL verify the Schnorr signature of every received incident, reject invalid or expired incidents, deduplicate by incident id, persist accepted incidents, and remove incidents once their expiry passes.

#### Scenario: Valid incident is accepted

- **WHEN** an incident arrives with a valid signature, an unexpired timestamp, and a known incident id
- **THEN** it is persisted and made available to the UI

#### Scenario: Invalid signature is rejected

- **WHEN** an incident arrives whose Schnorr signature does not verify against its reporter public key
- **THEN** the incident is discarded and never persisted

#### Scenario: Duplicate incident is ignored

- **WHEN** an incident arrives whose id has already been accepted
- **THEN** the duplicate is ignored

#### Scenario: Expired incident is removed

- **WHEN** the current time passes an accepted incident's expiry
- **THEN** the incident is removed from persistence and no longer rendered

### Requirement: Incident map rendering

The system SHALL render accepted, unexpired incidents as map markers using the type's icon and label.

#### Scenario: Accepted incident appears on the map

- **WHEN** an incident is accepted into the store
- **THEN** a marker with the incident type's icon is rendered at its coordinates

#### Scenario: Expired incident disappears

- **WHEN** an incident expires and is removed
- **THEN** its map marker is removed

### Requirement: In-navigation incident warnings

During active navigation, the system SHALL warn the user about accepted incidents located ahead on the active route, and SHALL limit warnings to avoid driver distraction.

#### Scenario: Incident ahead triggers a warning

- **WHEN** navigation is active and an accepted incident lies within the look-ahead window of the active route ahead of the current position
- **THEN** a non-blocking warning identifying the incident type is shown

#### Scenario: Incident behind the user does not warn

- **WHEN** navigation is active and an accepted incident lies only behind the current position on the route
- **THEN** no warning is shown

#### Scenario: Warning is issued once per incident per trip

- **WHEN** an incident has already triggered a warning during the current navigation session
- **THEN** it does not trigger another warning in that session

### Requirement: Offline incident replay

The offline queue SHALL support an incident entry type and SHALL replay queued incidents when connectivity returns.

#### Scenario: Queued incident is replayed

- **WHEN** the offline queue is flushed and contains an incident entry
- **THEN** the incident is broadcast through the active transport
