## Context

Region packs — PMTiles vector tiles, an Overture-derived `overture-places.sqlite` bundle, routing graphs, and geocoding data — are assembled by `scripts/generate-region-data.sh` / `build-region-bundle.sh` from public upstreams (OpenFreeMap, Overture's S3) and currently hosted on a Polaris CDN/GitHub Releases. The catalog that lists them (`catalogService.ts` → `REGION_CATALOG_URL`) is likewise Polaris-hosted.

The P2P half exists but is inert:

- On download, `autoSeedRegion` (`downloadService.ts:489`) calls `seedRegion()`, whose sidecar handler `handleHdSeed` (`nodejs-assets/nodejs-project/index.js:253`) does `new Hyperdrive(store)` — a **new writable drive per device**, hence a unique `key`/`discoveryKey` per seeder.
- `tryPeerDownload` (`downloadService.ts:266`) is gated on `region.driveKey` (`:152`), which on a fresh install comes from the catalog and is always `null` (no key field).
- Discovery joins the local drive's discovery key, so two devices seeding "us-new-york" advertise different swarms and can never connect.

Existing building blocks to reuse: the Node sidecar already opens read-only clones by key for download (`new Hyperdrive(store, key)` + `drive.corestore.replicate(conn)`), Hyperswarm join/flush works, and the identity layer provides `sign` / `verify` / `createSigningPayload` (secp256k1) plus `regions.drive_key` storage.

Terminology note: Hyperdrive keys are ed25519 writer public keys, not content hashes. "Canonical" here means a single stable writer key per `(region, data version)` that all seeders replicate; a separate `contentHash` in the manifest verifies the derived payload. We are not introducing IPFS-style CIDs.

## Goals / Non-Goals

**Goals:**

- One canonical, read-only, content-verifiable Hyperdrive per `(region, data version)`, replicated by every seeder so all peers share one discovery key.
- A signed region manifest as the trust root and key source, bootstrapped by a manifest bundled in the app.
- Seed-on-download replicates the canonical drive; `regions.drive_key` holds the canonical key; a fresh install with a known key attempts P2P before any origin.
- No new Polaris-hosted service.

**Non-Goals (later steps):**

- Monthly Overture delta feeds.
- Multi-publisher quorum / decentralized trust root (step 1 trusts a bundled publisher allowlist).
- Live-viewport P2P serving and Gun.js manifest gossip.
- Changing the Overture PMTiles live path.

## Decisions

**D1 — Canonical writer key + read-only replication (not per-device drives).**
The pack's canonical drive key is created once by the publisher. Other devices open a read-only clone with that key and keep replicating; because the clone's `key`/`discoveryKey` equal the publisher's, every seeder advertises the same topic.
_Alternatives:_ per-device drives plus a key registry — rejected: keys proliferate one-per-seeder, breaking single-topic discovery and deduplication.

**D2 — `hd-seed` gains an optional canonical `key`.**

- With `key`: open `new Hyperdrive(store, key)`, replicate, persist, join the canonical discovery key, and stay seeded. No writes.
- Without `key` (publisher/authoring path): create the writable drive, `drive.put` the files, join, and return `{ key, discoveryKey, contentHash }` from which the publisher builds a manifest.
  Detection of "read-only" is implicit: clones opened from a foreign key cannot write.

**D3 — Signed manifest as the trust root.**
Manifest `{ regionId, version, overtureRelease, driveKey, discoveryKey, contentHash, bytes, publisherPubkey, signature }`, signed over a canonical field join via `createSigningPayload`. The app verifies with `verify()` before trusting `driveKey`. Trusted publisher pubkeys come from a **bundled allowlist** (the manifest itself is bundled in the app binary). Remote catalog entries carrying manifest fields are accepted only if verified; unverifiable entries are ignored.
_Alternative:_ TOFU over Gun.js — deferred; needs gossip and anti-spam, which is step 2+.
_Consequence:_ step 1's trust root is compiled-in (like a DNS root / CA bundle), so it updates with app releases. This is the honest limitation of step 1; publisher-set decentralization is a later change.

**D4 — Bundled default manifest, remote may extend.**
A `region-manifest` constant ships in the app so a fresh install knows canonical keys offline. `catalogService` merges: bundled first, then verified remote entries. HTTP/CDN remains an optional fallback origin, not the key authority.

**D5 — Storage semantics.**
`regions.drive_key` now stores the canonical key. On upgrade, legacy per-device keys are treated as stale: the device unseeds its old drive and re-seeds read-only against the canonical key once known. No destructive migration of the user's already-downloaded files.

**D6 — Content verification.**
Hyperdrive's Merkle tree already verifies block integrity against the writer key. The manifest `contentHash` adds an app-level check of the assembled payload (e.g., hash over the sorted file list + sizes) so a verified manifest pins reproducible builds. Deferred: enforcing the hash before serving offline (documented as an open question).

**D7 — Publisher-only seeding for step 1 (accepted limitation).**
A device that acquired a pack over HTTP cannot serve the canonical drive's blocks: Hyperdrive is single-writer, so a read-only replica serves only blocks it already holds and cannot write the locally-downloaded files into the canonical drive. Step 1 therefore accepts that HTTP-acquired packs join the canonical swarm and store the canonical key, but only the publishing device — and any peer that acquired the pack **via** Hyperdrive — actually serves blocks. Peers that acquire packs P2P become seeders naturally. Proactively pulling blocks on HTTP-acquired packs (`drive.download('/')` on the read-only replica) is deferred.

## Risks / Trade-offs

- **[Cold start — no seeders yet]** → Keep the HTTP/Overture origin as fallback; a known key only _attempts_ P2P first. Availability is best-effort until the swarm has seeders.
- **[Bundled trust root is still central-ish]** → Explicitly scoped: step 1 decentralizes _distribution_, not yet _publisher governance_. Publisher-set changes ride app releases until step 2.
- **[Read-only clones can't be repaired by peers]** → Correct by design: content is immutable per version; a bad pack is superseded by a new `version` + manifest entry, not patched in place.
- **[Mobile seeding cost]** → Unchanged auto-seed behavior, now canonical; metering/opt-in is a later concern.
- **[Legacy per-device drives]** → On upgrade, leave their feeds and overwrite `drive_key`; harmless orphans, no data loss.
- **[Discspace]** → Read-only clones are sparse: peers fetch only requested blocks, not the whole pack.

## Migration Plan

1. Add the manifest type, signature verification, and a bundled default manifest (initially empty or one pilot region).
2. Add the sidecar clone/publish paths for `hd-seed` (`key` present vs absent).
3. Thread the canonical key through `hyperdriveBridge.seedRegion` and `downloadService` (`autoSeedRegion`, `tryPeerDownload`, the `:152` gate).
4. Persist the canonical key in `drive_key`; stop referencing legacy per-device keys.
5. Rollback: gate the canonical path behind a flag; fall back to the existing per-device seeding without schema changes.

## Open Questions

- Which pubkeys are in the initial bundled allowlist, and who operates the pilot seeder(s)?
- Should the manifest be published by CI at pack-build time, or signed by a maintainer key?
- Do we enforce `contentHash` before serving offline, or only log mismatches in step 1?
- Refine `contentHash` definition (sorted file list + byte sizes vs. a Merkle root over file hashes) — pick during implementation.
- Add best-effort block pull on HTTP-acquired packs (`drive.download('/')` on the read-only replica) so they can seed too? Currently deferred (see D7).
