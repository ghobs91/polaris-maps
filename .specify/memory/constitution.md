<!--
  Sync Impact Report
  Version change: N/A → 1.0.0 (initial ratification)
  Modified principles: N/A (first version)
  Added sections:
    - Core Principles (5): Code Quality, Testing Standards,
      UX Consistency, Performance Requirements, Atomic Commits
    - Security & Privacy Standards
    - Development Workflow
    - Governance
  Removed sections: None
  Templates requiring updates:
    - .specify/templates/plan-template.md ✅ (Constitution Check
      section already present and generic — compatible)
    - .specify/templates/spec-template.md ✅ (no constitution
      references required — compatible)
    - .specify/templates/tasks-template.md ✅ (phase structure
      aligns with atomic commit principle — compatible)
    - .specify/templates/checklist-template.md ✅ (generic —
      compatible)
  Follow-up TODOs: None
-->

# Polaris Maps Constitution

## Core Principles

### I. Code Quality

- All code MUST follow a single, enforced style guide per language.
  Linting and formatting MUST run automatically on every commit
  via pre-commit hooks or CI; no unformatted code may be merged.
- Every function, module, and component MUST have a single, clear
  responsibility. If a unit requires more than one sentence to
  describe its purpose, it MUST be split.
- Dead code, unused imports, and commented-out code MUST NOT exist
  in the main branch. Remove rather than comment out.
- All names (variables, functions, types, files) MUST be
  descriptive and self-documenting. Abbreviations are permitted
  only when they are industry-standard (e.g., `lat`, `lng`, `P2P`,
  `DHT`).
- Code duplication MUST be eliminated when the same logic appears
  in three or more locations. Two occurrences MAY remain if
  extraction would reduce clarity.
- Every module MUST expose a clear public API. Internal
  implementation details MUST NOT leak across module boundaries.
- Rationale: A decentralized system with many interacting
  subsystems (networking, rendering, routing, data sync) demands
  strict readability and modularity so that any contributor can
  understand and modify a component without hidden side effects.

### II. Testing Standards (NON-NEGOTIABLE)

- Every user-facing feature MUST have at least one integration
  test that exercises the feature end-to-end before it is
  considered complete.
- Every public function or method MUST have unit tests covering:
  the happy path, at least one error/edge case, and boundary
  conditions where applicable.
- Test coverage MUST NOT drop below the established baseline when
  new code is merged. New code MUST carry its own tests.
- Tests MUST be deterministic. Flaky tests MUST be quarantined
  and fixed within one sprint or removed.
- Contract tests MUST exist for every peer-to-peer protocol
  boundary (message formats, API contracts between nodes) to
  prevent silent protocol drift.
- Performance-sensitive paths (map tile rendering, route
  computation, traffic aggregation) MUST have benchmark tests
  with defined acceptable thresholds.
- Rationale: In a P2P system, bugs propagate across the entire
  network. Rigorous testing at every boundary is the primary
  defense against cascading failures and data corruption.

### III. User Experience Consistency

- All user-facing interfaces MUST follow a single, documented
  design system (typography, spacing, color, iconography,
  interaction patterns). Deviations require explicit justification.
- Identical user actions MUST produce identical interaction
  patterns across all screens and platforms. Search, navigation,
  and place details MUST behave consistently regardless of entry
  point.
- All map interactions (pan, zoom, tap, long-press) MUST respond
  within 100ms of user input. Visual feedback (loading spinners,
  skeleton screens) MUST appear within 200ms for operations
  that cannot complete instantly.
- Error states MUST be communicated to the user with actionable
  guidance — never raw error codes, stack traces, or silent
  failures.
- Offline and degraded-network states MUST be visually
  distinguishable from full-connectivity states, with clear
  indication of what functionality is available.
- Rationale: Users switching from Google/Apple Maps expect
  polished, predictable interactions. Consistency builds trust
  and lowers the adoption barrier for a decentralized alternative.

### IV. Performance Requirements

- Map tile rendering MUST achieve 60fps during pan and zoom on
  target devices. Frame drops below 30fps MUST be treated as
  P1 bugs.
- Route computation MUST complete in under 2 seconds for
  distances up to 100km on a mid-range smartphone.
- Cold app launch to interactive map MUST complete in under
  5 seconds. Warm launch MUST complete in under 2 seconds.
- Peer network operations (discovery, data sync, tile serving)
  MUST NOT degrade foreground UI responsiveness. All network I/O
  MUST execute off the main/UI thread.
- Memory usage MUST remain under 300MB during typical usage
  (map viewing + navigation). Background node operations MUST
  remain under 50MB.
- Battery impact of background peer participation MUST NOT exceed
  5% per hour on a mid-range smartphone under default resource
  settings.
- Every pull request that touches performance-sensitive code MUST
  include before/after benchmark results.
- Rationale: A mapping app that stutters, drains battery, or
  takes too long to load will be abandoned regardless of its
  decentralization benefits. Performance is a feature.

### V. Atomic Commits

- Each commit MUST represent exactly one logical change: a single
  bug fix, a single feature increment, a single refactor, or a
  single configuration change. Mixing concerns in one commit is
  prohibited.
- Commit messages MUST follow the Conventional Commits format:
  `type(scope): description` (e.g., `feat(routing): add cycling
mode support`, `fix(tiles): correct cache invalidation logic`).
- A commit MUST leave the codebase in a buildable, testable state.
  No commit may intentionally break the build or cause test
  failures.
- Large features MUST be decomposed into a sequence of small,
  reviewable commits — each independently understandable and
  ideally under 400 lines of diff. If a single commit exceeds
  400 lines, it MUST include a justification in the PR
  description.
- Refactoring MUST be separated from behavioral changes. A commit
  that renames or restructures code MUST NOT simultaneously alter
  functionality.
- Rationale: Small, focused commits enable meaningful code review,
  simplify bisecting for regressions, and produce a git history
  that serves as reliable project documentation. In a complex P2P
  system, traceability of changes is essential.

## Security & Privacy Standards

- All telemetry data MUST be anonymized on-device before
  transmission. Raw location traces MUST NOT leave the device.
- Peer identity MUST be based on cryptographic key pairs. Shared
  data MUST be signed by the originating peer to enable
  authenticity verification.
- All peer-to-peer communication MUST be encrypted in transit.
  Plaintext data exchange between peers is prohibited.
- User consent MUST be obtained before any data collection or
  sharing begins. Consent controls MUST be granular (location,
  traffic telemetry, imagery, business edits independently
  togglable).
- The application MUST NOT request or retain permissions beyond
  what is required for opted-in functionality. Permissions MUST
  be requested just-in-time with clear explanations.
- Third-party dependencies MUST be audited for known
  vulnerabilities before adoption and monitored continuously.
  Dependencies with unpatched critical CVEs MUST NOT ship.
- Rationale: A decentralized mapping app handles highly sensitive
  location data. Privacy failures would be catastrophic to user
  trust and potentially illegal under GDPR/CCPA.

## Development Workflow

- All changes MUST be submitted via pull requests against a
  feature branch. Direct commits to the main branch are
  prohibited.
- Every pull request MUST pass CI (lint, format, build, full test
  suite) before it is eligible for merge. No exceptions.
- Every pull request MUST be reviewed by at least one other
  contributor before merge. Self-merges are prohibited except for
  trivial documentation fixes.
- Pull requests SHOULD contain a cohesive set of atomic commits
  that together deliver a reviewable unit of work. Squash-merging
  is permitted only when the individual commits do not each stand
  on their own.
- Feature branches MUST be kept up to date with main via rebase.
  Merge commits from main into feature branches are discouraged.
- CI MUST enforce all Constitution principles automatically where
  tooling permits: linting, formatting, test coverage thresholds,
  commit message format, and dependency vulnerability scanning.
- Rationale: A consistent, automated workflow reduces friction,
  catches violations early, and ensures that every change reaching
  main has been verified against project standards.

## Governance

- This Constitution supersedes all other development practices
  and conventions for the Polaris Maps project. In case of
  conflict, the Constitution takes precedence.
- All pull requests and code reviews MUST verify compliance with
  these principles. Reviewers MUST flag violations and authors
  MUST resolve them before merge.
- Amendments to this Constitution require:
  1. A written proposal describing the change and rationale.
  2. Review and approval by at least two active contributors.
  3. A migration plan if the amendment affects existing code.
  4. Version increment following semantic versioning:
     MAJOR for principle removals/redefinitions, MINOR for
     additions/expansions, PATCH for clarifications/typo fixes.
- Complexity beyond what is prescribed here MUST be justified in
  writing (in the relevant PR description) with an explanation of
  why a simpler alternative is insufficient.
- A compliance review of the codebase against this Constitution
  SHOULD be conducted quarterly or after any MAJOR version
  amendment.

**Version**: 1.0.0 | **Ratified**: 2026-03-05 | **Last Amended**: 2026-03-05
