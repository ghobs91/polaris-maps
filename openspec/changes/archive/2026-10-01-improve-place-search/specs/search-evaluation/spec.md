## ADDED Requirements

### Requirement: Search latency benchmark

The repository SHALL provide a runnable benchmark that measures local full-text search, prefix lookup, structured address lookup, trigram lookup, and incremental versus full index maintenance against a synthetic places database, and reports percentile timings.

#### Scenario: Benchmark runs from a package script

- **WHEN** a developer runs the search benchmark command
- **THEN** it SHALL seed a synthetic database, run each measurement, and print p50/p95 timings as machine-readable output
- **AND** it SHALL require no new dependency

#### Scenario: Index maintenance regression detected

- **WHEN** the incremental upsert path regresses toward full-rebuild cost on the search path
- **THEN** the benchmark output SHALL show the increase in the maintenance measurement

### Requirement: Search quality evaluation

The repository SHALL maintain a fixture of at least 30 realistic search queries with expected top-3 results, evaluated through the unified search pipeline with network sources mocked and the real ranker active. The evaluation SHALL assert recall@3 and NDCG thresholds.

#### Scenario: Evaluation gate fails on ranking regression

- **WHEN** a ranking change removes an expected result from the top 3 for a fixture query
- **THEN** the evaluation test SHALL fail with the offending query identified

#### Scenario: Sparse-local fixtures required

- **WHEN** the gating thresholds are changed
- **THEN** the evaluation suite SHALL include fixtures where local results are sparse or empty
- **AND** the suite SHALL verify that network sources still contribute expected results

### Requirement: Orchestration behavior tests

The repository SHALL test staged emission ordering, source gating call counts, cache behavior, and abort handling with mocked sources, using deterministic simulated latencies.

#### Scenario: Staged order asserted

- **WHEN** sources are configured to resolve in a fixed order
- **THEN** the test SHALL assert that emissions occur in the documented stage order
- **AND** no stage emission SHALL wait for a slower later stage

#### Scenario: Gating call counts asserted

- **WHEN** a query produces sufficient strong local matches
- **THEN** the test SHALL assert the gated network source was not called
