## ADDED Requirements

### Requirement: Hyperdrive runs in a Bare worklet

The app SHALL host Corestore + Hyperdrive inside a `react-native-bare-kit` Bare worklet, built into a committed bundle, and SHALL NOT depend on the absent `NodeChannel` native module for region-pack transport.

#### Scenario: Worklet starts with the runtime available

- **WHEN** the app initializes region-pack transport and the Bare bundle is present
- **THEN** the worklet starts and establishes its RPC channel

#### Scenario: Missing runtime degrades gracefully

- **WHEN** the Bare runtime or bundle is unavailable (e.g. tests, unsupported build)
- **THEN** the bridge no-ops instead of throwing at import or crashing startup

### Requirement: Seed a pack author or read-only

The worklet SHALL seed a region pack either by authoring a writable canonical drive from a files directory, or by opening a read-only replica of a given canonical key, and SHALL report the resulting key + discovery key.

#### Scenario: Author path creates the canonical drive

- **WHEN** the worklet seeds a region with no canonical key
- **THEN** it creates a writable Hyperdrive from the files directory, joins the swarm, and returns the key + discovery key

#### Scenario: Read-only path joins the canonical swarm

- **WHEN** the worklet seeds a region with a canonical key
- **THEN** it opens a read-only replica and joins the canonical discovery key without writing

### Requirement: Download a pack from peers with progress

The worklet SHALL download a pack from peers by canonical key, write the files under the destination directory, and report byte progress to the app.

#### Scenario: Download replicates files

- **WHEN** the app requests a download for a known canonical key
- **THEN** the worklet joins the swarm, replicates the drive, and writes its files to the destination directory

#### Scenario: Progress is streamed

- **WHEN** files are transferred
- **THEN** the worklet emits progress events the app can surface

### Requirement: Status and unseed

The worklet SHALL report the seeded drives (region, key, discovery key, peers) and SHALL release a seeded region on request.

#### Scenario: Status lists seeded drives

- **WHEN** the app requests status
- **THEN** the worklet returns each seeded region's key, discovery key, and peer count

#### Scenario: Unseed releases resources

- **WHEN** the app unseeds a region
- **THEN** the worklet stops replicating/joining that drive and releases its resources

### Requirement: Bridge preserves the existing API

The React Native bridge SHALL expose the same operations the app already consumes (`seedRegion`, `downloadFromPeers`, `unseedRegion`, `getHyperdriveStatus`) so existing callers need no changes.

#### Scenario: Callers are unaffected

- **WHEN** `downloadService` calls `seedRegion` / `downloadFromPeers` / `unseedRegion`
- **THEN** those functions behave as before, now backed by the Bare worklet
