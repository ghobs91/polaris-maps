## ADDED Requirements

### Requirement: Publish signed manifests peer-to-peer

The app SHALL publish signed region manifests to a peer-to-peer namespace keyed by region and publisher, without requiring a Polaris-hosted service.

#### Scenario: A publisher advertises a region

- **WHEN** the publishing device has a signed manifest for a region
- **THEN** it publishes the manifest to the `region-manifests` namespace under the region id and its publisher key

### Requirement: Verify before merge

On receiving a manifest from any source, the app SHALL verify its signature against a trusted publisher before merging it, and SHALL ignore manifests that fail verification.

#### Scenario: Trusted manifest is merged

- **WHEN** a received manifest verifies against a trusted publisher
- **THEN** the app merges it as a candidate for that region

#### Scenario: Untrusted or tampered manifest is dropped

- **WHEN** a received manifest fails signature or trust verification
- **THEN** the app neither stores nor relays it

### Requirement: Relay verified manifests

The app SHALL re-publish verified manifests it holds so discovery has no single origin.

#### Scenario: A relayed manifest reaches a peer with no direct path to the publisher

- **WHEN** the app holds a verified manifest it received from a peer
- **THEN** it makes that manifest available to other peers through the namespace

### Requirement: Persist and discover offline

The app SHALL persist verified remote manifests so they are available offline and after a restart, bounded per region.

#### Scenario: Discovery survives a restart

- **WHEN** the app restarts with no network
- **THEN** previously verified manifests are still available to the download flow

### Requirement: Multi-publisher trust with optional quorum

The app SHALL support a trusted-publisher set and an optional per-region M-of-N quorum, and SHALL resolve a region deterministically — never arbitrarily — when publishers disagree.

#### Scenario: Single trusted publisher suffices by default

- **WHEN** a region has no configured quorum and one trusted publisher advertises it
- **THEN** that manifest is accepted

#### Scenario: Configured quorum requires agreement

- **WHEN** a region requires M of N publishers and fewer than M distinct trusted publishers advertise the same `driveKey`
- **THEN** the region is left unresolved

#### Scenario: Conflicting trusted publishers do not resolve arbitrarily

- **WHEN** trusted publishers advertise different `driveKey` values for a quorum region
- **THEN** the app does not select one arbitrarily and the region remains unresolved

### Requirement: Version supersede

The app SHALL keep the highest verified manifest version per region and ignore older or equal versions.

#### Scenario: Newer manifest replaces an older one

- **WHEN** a verified manifest with a higher version arrives for a region
- **THEN** it replaces the previously held manifest for that region

#### Scenario: Older manifest does not regress

- **WHEN** a verified manifest with an equal or lower version arrives
- **THEN** the held manifest is unchanged
