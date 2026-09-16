## ADDED Requirements

### Requirement: Core functionality requires no paid or metered API

The app SHALL provide map viewing, navigation, traffic, POI search, imagery, and offline regions without requiring any paid API key, paid account, or metered third-party quota. No paid or metered API key may be required at build time or at runtime.

#### Scenario: Fresh install with no paid keys

- **WHEN** the app is built and launched with no paid or metered API keys present in the environment
- **THEN** map rendering, navigation, traffic, POI search, and imagery all initialize
- **AND** no feature is disabled solely because a paid key is absent

#### Scenario: Runtime works without a paid request

- **WHEN** the user views the map, navigates a route, or opens a place
- **THEN** every feature produces a result from allowed sources without depending on a paid provider

### Requirement: Bounded cold-start exception for traffic bootstrap

Traffic flow/raster bootstrap MAY use a single existing commercial provider as a temporary, time-boxed cold-start bridge while P2P density and free open-feed coverage are insufficient. The exception MUST be limited to traffic flow and raster bootstrap, MUST be optional and configurable, MUST degrade gracefully when absent or unreachable, and MUST NOT be required by any other feature or capability.

#### Scenario: Exception is confined to traffic bootstrap

- **WHEN** the cold-start traffic bridge is configured
- **THEN** it is consulted only for unresolved traffic flow or raster cells
- **AND** no other feature depends on it

#### Scenario: Exception is optional and absent by default

- **WHEN** the app is built and run without the cold-start provider configured
- **THEN** traffic still resolves from P2P and open feeds
- **AND** no build or runtime error results from its absence

#### Scenario: Exception degrades gracefully

- **WHEN** the cold-start provider is unreachable, rate-limited, or returns no data
- **THEN** traffic resolution continues through the lower-priority tiers
- **AND** the user sees only the normal coverage state, never a blocking error

#### Scenario: Exception is time-boxed and tracked

- **WHEN** the cold-start bridge remains enabled after P2P density and open-feed coverage are sufficient
- **THEN** its retirement is tracked as a documented follow-up with an exit criterion
- **AND** it is not treated as a permanent data source

### Requirement: No new paid providers

The app SHALL NOT integrate any new paid provider or paid-tier dependency. The only permitted commercial path is the bounded traffic cold-start bridge defined above; every other data source MUST be free and open.

#### Scenario: Candidate paid provider rejected

- **WHEN** a candidate provider requires payment, a paid account, or a free tier that begins billing or blocking after a request quota
- **THEN** the provider MUST NOT be integrated

#### Scenario: Existing paid paths are retired

- **WHEN** a paid provider is outside the bounded traffic exception
- **THEN** it is removed from the app rather than retained or extended

### Requirement: Allowed data sources

The app SHALL source data from free keyless feeds, free-keyed government or open feeds, self-hosted or community-operated infrastructure, P2P peers, and the on-device platform capabilities of the host OS.

#### Scenario: Source is an allowed class

- **WHEN** a data source is added or retained
- **THEN** it is one of: a keyless open feed, a free-keyed government or open feed that does not bill after a quota, self-hosted/community infrastructure, or an on-device platform API
- **AND** its terms permit the app's usage without a paid plan

#### Scenario: Self-hosted or community infrastructure permitted

- **WHEN** a data source is self-hosted by the project or operated by a community without per-request billing
- **THEN** it is permitted as an allowed source

### Requirement: Unavailable sources degrade with an explicit user-visible state

When a data source is unavailable or returns no data for the current context, the dependent feature SHALL degrade gracefully with an explicit, user-visible coverage or empty state. Silent failure, raw error codes, stack traces, and provider error text MUST NOT be shown to the user.

#### Scenario: Unreachable source shows a coverage state

- **WHEN** a data source is unreachable or returns no data for the current context
- **THEN** the feature shows a coverage or empty state that names the data type and its limited availability
- **AND** no raw error, stack trace, HTTP status, or provider error string is displayed

#### Scenario: Degraded state is distinguishable

- **WHEN** a feature is running with partial or no data
- **THEN** the UI visually distinguishes the degraded state from a fully covered state

#### Scenario: Failure never blocks the app

- **WHEN** any single data source fails
- **THEN** the rest of the app remains interactive
- **AND** the failure does not surface as a crash or a blocking error dialog

### Requirement: Retired paid web services are deleted, not disabled

Paid web-service integrations retired by this change — including the MapKit JS PlaceDetail embed and the Apple Maps Server API client — SHALL be deleted from the codebase rather than disabled behind a flag, toggle, or environment check. No client module, key constant, endpoint constant, hosted page, token script, or associated test may remain.

#### Scenario: Retired paid client deleted

- **WHEN** a retired paid web service is removed
- **THEN** its client module, key constant, endpoint constant, hosted page, token generation script, and associated tests are removed from the repository

#### Scenario: No runtime re-enable path

- **WHEN** the app runs
- **THEN** no flag, setting, or environment value can re-enable a retired paid web service path

#### Scenario: No orphaned provider references

- **WHEN** the codebase is searched for a retired provider's name or endpoint
- **THEN** no runtime source file, config, or environment template references it
