## ADDED Requirements

### Requirement: Always-on seeding independent of the app lifecycle

The desktop relay SHALL seed region packs as a background service that continues across the Polaris Maps app being quit, force-quit, or updated, and across user logout/login, without requiring any UI process to be running.

#### Scenario: App quit does not stop seeding

- **WHEN** the user quits the Polaris Maps app (or the menu-bar controller) while the relay is seeding a region
- **THEN** the relay process keeps running and peers continue to replicate packs from it

#### Scenario: Relay restarts after a crash

- **WHEN** the relay process exits unexpectedly
- **THEN** the user's launch agent restarts it within its throttle interval and replication resumes from persisted state

#### Scenario: An explicit stop stays stopped

- **WHEN** the user stops the relay through the control socket
- **THEN** the relay exits cleanly and is not restarted, until explicitly started again

### Requirement: Read-only canonical replication only

The relay SHALL seed only read-only replicas of canonical region-pack drives identified by a signed region manifest, and SHALL never author or mutate a pack drive.

#### Scenario: Relay joins the canonical discovery topic

- **WHEN** the relay seeds a region whose manifest supplies a canonical drive key
- **THEN** it opens a read-only replica of that key, joins the canonical discovery key, and reports the same `key`/`discoveryKey` as any other seeder

#### Scenario: Unverifiable manifest is refused

- **WHEN** a pack's manifest signature does not verify, or the pack's content hash does not match the manifest
- **THEN** the relay refuses to seed that pack and reports the reason in its status

### Requirement: Bounded, revocable resource use

The relay SHALL enforce user-visible budgets for disk, egress, concurrency, and per-peer rate, SHALL refuse work that would exceed a disk budget rather than silently evicting a pinned region, and SHALL pause replication on the conditions recorded in the pause matrix.

#### Scenario: Disk budget refuses rather than evicts a pin

- **WHEN** seeding a new region would exceed the pack-store budget and the store contains pinned regions
- **THEN** the new region is not seeded and the refusal is reported, with pinned regions untouched

#### Scenario: Egress cap stops serving for the period

- **WHEN** a relay reaches its monthly egress cap
- **THEN** it stops serving for the remainder of the period and reports the cap as the pause reason

#### Scenario: Battery pauses by default

- **WHEN** the host moves to battery power or Low Power Mode and the user has not opted in
- **THEN** replication pauses and the reason is reported through the control socket

### Requirement: Local-only control plane

The relay's control plane SHALL be a filesystem socket owned by the user with mode `0600` in a `0700` directory, SHALL reject requests from other user ids, and SHALL NOT open any listening network port in any mode.

#### Scenario: No listening TCP port

- **WHEN** the relay is serving packs on a network
- **THEN** no TCP port is bound for control or for tile serving; all peer traffic is swarm connections

#### Scenario: Foreign uid is rejected

- **WHEN** a process running as a different user id connects to the control socket
- **THEN** the request is rejected without executing any command

### Requirement: Signed availability announcements

A relay SHALL publish a signed announcement of the regions it seeds, its capacity, its usage, and whether it is paused, and clients SHALL verify the signature and treat the announcement as availability metadata only.

#### Scenario: Client learns a region is relay-covered

- **WHEN** a client reads a fresh, correctly signed announcement naming a region it is about to download
- **THEN** it treats that region as relay-covered and prefers the P2P path for the download

#### Scenario: Forged announcement cannot alter content trust

- **WHEN** an announcement is signed by a key the client has never seen, or fails verification
- **THEN** the client ignores it for scheduling and content verification remains unchanged

#### Scenario: Stale announcement expires

- **WHEN** an announcement's `updatedAt` is older than its TTL
- **THEN** the client stops treating the region as relay-covered

### Requirement: Phones seed only as a fallback

A mobile device SHALL consult its explicit seeding preference and the verified relay coverage for a region before seeding a downloaded pack, and SHALL NOT seed a relay-covered region unless the user opted in.

#### Scenario: Covered phone does not seed

- **WHEN** a phone downloads a region that a healthy relay covers and the preference is `auto`
- **THEN** the phone does not seed that region and records why

#### Scenario: Uncovered phone keeps the mesh alive

- **WHEN** no relay covers a downloaded region
- **THEN** the phone seeds it under the existing power, link, and free-disk conditions, so a phone-only network behaves as before

#### Scenario: Explicit preference always wins

- **WHEN** the preference is `always`
- **THEN** the phone seeds even when a relay covers the region; when it is `never`, it does not seed regardless of coverage

### Requirement: Small latency-critical data stays device-to-device

Traffic probes, conditions, and tiles SHALL continue to be exchanged directly between devices, and a relay SHALL NOT be required for any real-time traffic feature.

#### Scenario: Traffic works with no relay

- **WHEN** no relay is present on the network
- **THEN** traffic probes, conditions, and tile exchange behave exactly as they do today
