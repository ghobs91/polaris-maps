## ADDED Requirements

### Requirement: Consent-gated probe collection lifecycle

The system SHALL start probe collection only when `permissions.trafficTelemetryEnabled` is true AND the app is foregrounded, and SHALL stop collection when the app is backgrounded/inactive or consent is revoked. The system MUST react to consent changes made while the app is running.

#### Scenario: Collection starts on foreground with consent

- **WHEN** the app transitions to the active state and `trafficTelemetryEnabled` is true
- **THEN** the probe collector is started

#### Scenario: Collection stops on background

- **WHEN** the app transitions to the background state while collecting
- **THEN** the probe collector is stopped immediately

#### Scenario: Consent revoked stops collection

- **WHEN** the user disables `trafficTelemetryEnabled` while the app is foregrounded and collection is active
- **THEN** the probe collector is stopped without requiring an app restart

#### Scenario: Consent granted starts collection

- **WHEN** the user enables `trafficTelemetryEnabled` while the app is foregrounded
- **THEN** the probe collector is started

#### Scenario: No collection before consent resolves

- **WHEN** the app starts before the persisted permission state is available
- **THEN** no probe is collected or published until `trafficTelemetryEnabled` is known to be true

### Requirement: Probe publishing with transport selection

The system SHALL publish each collected probe over Hyperswarm when the worklet is started and `swarmPeerCount` is at least `MIN_PEER_THRESHOLD`, and SHALL otherwise publish over the Nostr fallback scoped to the probe's geohash4 cell.

#### Scenario: Hyperswarm is primary when peers are present

- **WHEN** a probe is collected, the Hyperswarm worklet is started, and `swarmPeerCount >= MIN_PEER_THRESHOLD`
- **THEN** the probe is published via `hyperswarmBridge.publishProbe`

#### Scenario: Nostr fallback when peers are sparse

- **WHEN** a probe is collected and `swarmPeerCount < MIN_PEER_THRESHOLD`
- **THEN** the probe is published via `nostrFallback.publishProbe` for its geohash4 cell

#### Scenario: Slow or stationary probes are skipped

- **WHEN** the collected speed is below the minimum publish speed
- **THEN** no probe is published

### Requirement: Anonymous probe identity

The system SHALL associate probes with a rotating ephemeral probe ID and MUST NOT transmit the reporter's public key or a raw location trace with a probe.

#### Scenario: Probe ID rotates hourly

- **WHEN** more than one hour has elapsed since the current probe ID was created
- **THEN** the next probe uses a newly generated random probe ID

#### Scenario: Probe payload carries no identity

- **WHEN** a probe is encoded for transmission
- **THEN** the payload contains geohash, segment, speed, bearing, timestamp, and probe ID only

### Requirement: Probe collection state is observable

The system SHALL reflect whether probe collection is active in the traffic store.

#### Scenario: Store mirrors collection state

- **WHEN** the probe collector starts or stops
- **THEN** `trafficStore.isCollectingProbes` is updated to match
