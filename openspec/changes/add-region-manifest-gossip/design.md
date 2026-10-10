## Context

Step 1 established the manifest format and verification (`regionManifest.ts`) and a bundled root of trust, but remote manifests only enter through the CDN catalog (`catalogService.ts`), and trust is a single allowlist shipped in the binary. Gun.js (already the app's CRDT layer for POI edits/reviews/reputation) provides a mutable, keyed, peer-relayed graph, and Hyperswarm is already used for topic-based discovery — both are available without new infrastructure.

## Goals / Non-Goals

**Goals:**

- Discover and verify region manifests peer-to-peer, with no Polaris CDN in the path.
- Let any number of trusted publishers advertise a region; clients merge, supersede by version, and relay.
- Multi-publisher trust: a publisher set with an optional per-region M-of-N quorum.
- Persist verified manifests for offline/restart discovery.

**Non-Goals (later):** per-region delta feeds; live-viewport P2P serving; pack seeding mechanics; changing the Overture PMTiles path.

## Decisions

**D1 — Gun.js is the manifest gossip substrate.** Manifests are small JSON records; Gun's graph already relays and de-duplicates writes and is in-stack. Hyperswarm topic announces are an optional accelerator, not a requirement.
_Alternative:_ a bespoke Hyperswarm pub/sub channel — rejected: reuses less, and Gun already gives relayed, mergeable keyed records.

**D2 — Namespace by region and publisher.** `polaris/region-manifests/<regionId>/<publisherPubkey>` → manifest. Keying by publisher lets multiple publishers coexist for a region so clients can merge/quorum rather than last-write-wins clobbering.

**D3 — Multi-publisher trust: set + optional M-of-N quorum.** The trusted set replaces the single allowlist. Default quorum is M=1 (any one trusted publisher). A region may configure a higher M; clients collect distinct publisher attestations and accept a manifest only when M distinct trusted publishers agree on the same `driveKey`.
_Consequence:_ higher M trades liveness for resistance to a single compromised publisher.

**D4 — Deterministic resolution.** Accept the highest verified `version` per region. When quorum is configured, entries must agree on `driveKey`; if trusted publishers disagree, the region is unresolved until quorum is met (never pick arbitrarily). Version comparison requires a monotonic, comparable encoding (e.g. zero-padded numeric or a documented `major.minor` scheme) — pin during implementation.

**D5 — Relay and persist.** On verifying an incoming manifest, republish it to the namespace (relay) and store it locally. Persist verified manifests in a bounded MMKV/SQLite map keyed by regionId (cap entries per region) so discovery works offline and across restarts without re-fetching.

**D6 — Anti-spam.** Only manifests from the trusted set are stored or relayed; per-region storage is capped; oversized/invalid records are dropped before persistence.

**D7 — CDN catalog demoted.** The HTTPS catalog becomes an optional hint (same as a peer), not the authority; the bundled manifest remains the compiled-in bootstrap.

## Risks / Trade-offs

- **[Gun relay unavailability]** → Hyperswarm announce is an optional second path; the bundled manifest and HTTPS hint still work.
- **[Quorum liveness]** → default M=1; higher M is opt-in for regions that want it.
- **[Trusted-publisher rollback]** → a trusted key can publish an older version; mitigate by storing the highest seen version and, later, signed timestamps. Documented as an accepted step-2 limitation.
- **[Storage/graph growth]** → cap entries per region; verify before storing.
- **[Version encoding bugs]** → pin a monotonic comparable format with tests (blocks supersede logic otherwise).

## Migration Plan

1. Add the gossip module (namespace publish/subscribe) behind the existing verifier.
2. Extend the resolver to merge gossiped manifests with bundled/catalog ones (bundled still wins).
3. Add multi-publisher set + quorum resolution.
4. Persist verified manifests; load on startup.
5. Optionally announce on a Hyperswarm topic.
6. Rollback: disable the gossip subscription; the bundled + catalog paths remain intact.

## Open Questions

- Version encoding to use for monotonic supersede (step 1 currently uses `'1.0'`).
- Whether quorum is configured per region in the bundled manifest or globally.
- Whether to add signed timestamps now to bound rollback.
- Hyperswarm announce topic derivation (region id vs geohash).
