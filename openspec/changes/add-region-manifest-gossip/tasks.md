## 1. Gossip transport

- [x] 1.1 Add `src/services/regions/regionManifestGossip.ts`: publish a signed manifest to `polaris/region-manifests/<regionId>/<publisherPubkey>` via Gun.js
- [x] 1.2 Subscribe to the namespace and surface received records for verification
- [ ] 1.3 Optional: announce/join a Hyperswarm manifest topic (region id) as a second discovery path

## 2. Verify, merge, relay

- [x] 2.1 Verify every received manifest with `verifyRegionManifest` before merge; drop failures
- [x] 2.2 Merge verified manifests through the resolver; keep newest per region
- [x] 2.3 Re-publish (relay) verified manifests the device holds
- [x] 2.4 Unit tests: untrusted/tampered records dropped; verified records merged and relayed (Gun mocked)

## 3. Persistence

- [x] 3.1 Persist verified remote manifests locally, bounded per region (MMKV)
- [x] 3.2 Load persisted manifests on startup and feed them to the resolver
- [x] 3.3 Unit tests: discovery survives a restart with no network

## 4. Multi-publisher trust + versioning

- [x] 4.1 Extend `regionPublishers.ts` from a single allowlist to a trusted set + optional per-region quorum config
- [x] 4.2 Pin a monotonic, comparable manifest `version` encoding and document it
- [x] 4.3 Implement deterministic resolution: highest version per region; M-of-N quorum must agree on `driveKey`; never pick arbitrarily
- [x] 4.4 Unit tests: single-publisher accept; quorum unmet → unresolved; conflicting publishers → unresolved; equal/lower version does not regress

## 5. Wiring

- [x] 5.1 Feed gossiped manifests into `regionManifestResolver` alongside bundled + catalog sources
- [x] 5.2 Demote the HTTPS region catalog to an optional hint (same trust path as a peer)
- [x] 5.3 Ensure the bundled manifest still wins as the compiled-in root of trust

## 6. Verification

- [x] 6.1 Run `pnpm typecheck && pnpm lint && pnpm format:check`
- [x] 6.2 Run the targeted Jest suites (gossip, resolver, trust/quorum, supersede) and report actual results
- [ ] 6.3 Update `src/services/regions/README.md` and `src/services/sync/README.md` for manifest gossip
- [ ] 6.4 Manual smoke: publish a manifest on one device, discover and merge it on a second through the gossip path
