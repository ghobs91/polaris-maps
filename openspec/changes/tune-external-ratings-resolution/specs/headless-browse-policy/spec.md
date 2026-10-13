## ADDED Requirements

### Requirement: Bounded per-provider resolution

Each provider's resolution SHALL be bounded by its own budget, armed when that provider becomes active, and SHALL NOT be starved by another provider's budget. Within a provider, a listing discovered by search SHALL be resolved with a plain fetch when the page permits it, using the hidden WebView only as a fallback, so the number of sequential browse stages is minimised. A candidate URL outside the provider host allowlist SHALL be rejected without being loaded.

#### Scenario: Search-derived listing resolves without a second browse stage

- **WHEN** the search stage selects a listing whose page is readable by a plain fetch
- **THEN** the rating is parsed from that fetch
- **AND** no second hidden-WebView stage is mounted for it

#### Scenario: Blocked fetch falls back to the browse stage

- **WHEN** the plain fetch of a search-selected listing is challenged, empty, or times out
- **THEN** the listing is loaded in the hidden WebView instead

#### Scenario: A queued provider still gets its turn

- **WHEN** one provider holds the single hidden-WebView slot and exhausts its clock
- **THEN** the queued provider is resolved afterwards with its own budget, rather than being failed by the first provider's budget

#### Scenario: Off-allowlist candidate is not loaded

- **WHEN** a search page yields a candidate URL outside the provider allowlist
- **THEN** it is rejected and never loaded

### Requirement: Verdicts are remembered, failures are retried

A provider resolution that ends without a verdict — a stage timeout, a provider budget, a network error, or a search page that yielded nothing — SHALL stay retryable, so a later card open tries again. Only a provider page that rendered and answered (a detected challenge, an identity mismatch, or a listing without rating data) SHALL be recorded as a remembered miss for the session. In-page collection pacing SHALL be sized so the collector posts its verdict before the stage clock unmounts the WebView.

#### Scenario: Timeout stays retryable

- **WHEN** a provider's stage times out with nothing learned
- **THEN** the provider renders no rating for that open
- **AND** the place is not recorded as a remembered miss

#### Scenario: Rendered verdict is remembered

- **WHEN** a loaded page reports an anti-bot challenge, a mismatched listing identity, or no rating data
- **THEN** the provider gives up silently and the miss is remembered for the session

#### Scenario: Collector posts before the stage clock

- **WHEN** a page never yields data and the collector exhausts its attempts
- **THEN** it posts its final state, including the challenge classification, before the stage clock fires
