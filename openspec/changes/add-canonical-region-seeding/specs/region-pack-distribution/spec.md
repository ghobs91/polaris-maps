## ADDED Requirements

### Requirement: Canonical region pack identity

Each `(region, data version)` pack SHALL have exactly one canonical Hyperdrive writer key, and every device that seeds that pack SHALL replicate the canonical drive so its `key` and `discoveryKey` are identical across seeders.

#### Scenario: Two seeders advertise the same discovery key

- **WHEN** two devices seed the same region and data version
- **THEN** both report the same canonical `key` and `discoveryKey`

#### Scenario: A fresh device downloads from any seeder

- **WHEN** a device without the pack knows the canonical key and joins the swarm
- **THEN** it can download the pack from any connected seeder, regardless of which device seeded it

### Requirement: Signed region manifest is the key authority

The app SHALL obtain canonical keys from a signed region manifest and SHALL only trust a `driveKey` whose manifest signature verifies against a trusted publisher public key.

#### Scenario: Valid manifest is accepted

- **WHEN** a manifest's signature verifies against a trusted publisher key and its fields are well-formed
- **THEN** the app treats its `driveKey` as the canonical key for that region

#### Scenario: Tampered manifest is rejected

- **WHEN** a manifest's `driveKey` or metadata is altered after signing
- **THEN** signature verification fails and the key is not trusted

#### Scenario: Unknown publisher is rejected

- **WHEN** a manifest is signed by a public key not in the trusted publisher set
- **THEN** the app ignores the manifest and does not attempt to seed from its `driveKey`

### Requirement: Bundled bootstrap manifest

The app SHALL ship a bundled region manifest so canonical keys are available offline on a fresh install, and MAY merge additional verified manifests from a remote catalog.

#### Scenario: Fresh install offline knows canonical keys

- **WHEN** the app launches with no network and no cached catalog
- **THEN** canonical keys from the bundled manifest are available to the download flow

#### Scenario: Remote entries extend the bundled manifest

- **WHEN** a remote catalog supplies signed manifest entries for regions not in the bundled manifest
- **THEN** the app verifies and merges them, without overriding a trusted bundled entry with an unverified one

### Requirement: Read-only seeding of foreign packs

A device that did not author a pack SHALL seed it from the canonical key as a read-only replica that cannot mutate the pack's contents.

#### Scenario: Seed with a canonical key opens a read-only clone

- **WHEN** `hd-seed` is invoked with a canonical `key`
- **THEN** the sidecar opens a read-only Hyperdrive clone, joins the canonical discovery key, and performs no writes

#### Scenario: Publisher path creates the canonical drive once

- **WHEN** `hd-seed` is invoked without a canonical `key` (authoring the pack)
- **THEN** the sidecar creates the writable drive, imports the files, joins the swarm, and returns the resulting canonical `key`

### Requirement: Seed-on-download and fetch ordering use the canonical key

After a device obtains a pack, it SHALL seed the canonical read-only drive, persist the canonical key in `regions.drive_key`, and SHALL attempt P2P download before any origin when the canonical key is known.

#### Scenario: Download seeds the canonical drive

- **WHEN** a pack finishes downloading from the origin
- **THEN** the device seeds the canonical read-only drive and stores the canonical key in `regions.drive_key`

#### Scenario: Known canonical key attempts peers first

- **WHEN** a fresh install has a canonical key for a region from the manifest
- **THEN** it attempts the P2P download before falling back to the origin
