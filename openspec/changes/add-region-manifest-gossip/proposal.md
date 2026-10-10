## Why

Step 1 (`add-canonical-region-seeding`) gave region packs a canonical, signed-manifest key, but discovery is still centralized in two ways: the trust set is a single allowlist shipped in the app binary, and remote manifests arrive only via the Polaris CDN catalog. For a decentralized network that must work if the developer disappears, manifests have to be discoverable and verifiable **peer-to-peer**, and trust must scale beyond one shipped publisher key — any number of community publishers should be able to advertise a packet, with clients merging and relaying verified manifests.

## What Changes

- **Publish signed manifests peer-to-peer**: advertise manifests on a Gun.js namespace (e.g. `polaris/region-manifests/<regionId>`) and, optionally, announce them on a Hyperswarm manifest topic. No CDN required for discovery.
- **Subscribe, verify, merge, and relay**: clients merge incoming manifests through the existing verifier, keep the newest verified entry per region, and re-gossip what they hold so discovery has no single origin.
- **Persist verified manifests locally** (SQLite/MMKV) so discovery survives restarts and is available offline.
- **Multi-publisher trust model**: replace the single bundled allowlist with a trusted-publisher **set** plus an optional per-region **M-of-N quorum**. When several trusted publishers advertise the same region, resolve deterministically (highest version; ties broken by a documented rule).
- **Supersede by version**: a newer verified manifest replaces an older one for the same region; older/equal versions are ignored.
- The HTTPS region catalog is demoted to an optional hint/fallback, not the discovery authority.

Out of scope (later steps): per-region delta feeds; live-viewport P2P serving; changing pack seeding mechanics (step 1).

## Capabilities

### New Capabilities

- `region-manifest-gossip`: Peer-to-peer publication, discovery, verification, relay, local persistence, and multi-publisher (set + optional quorum) trust for signed region manifests.

### Modified Capabilities

<!-- None. `region-pack-distribution` is still an unarchived change; this adds a
     separate capability rather than editing an unarchived spec. -->

## Impact

- **Resolver**: `src/services/regions/regionManifestResolver.ts` — multi-publisher merge, quorum, version supersede.
- **New**: `src/services/regions/regionManifestGossip.ts` — Gun.js publish/subscribe + relay and local persistence of verified manifests.
- **Trust config**: `src/constants/regionPublishers.ts` — publisher set + optional quorum configuration.
- **Transport**: `src/services/gun/` namespace; optional Hyperswarm announce via `src/services/sync/`.
- **Storage**: a verified-manifest table/namespace (SQLite or MMKV) for offline discovery.
- **Tests**: verification, quorum, version supersede, and a gossip round-trip with Gun mocked.
- **No new Polaris server**: Overture's public mirrors remain the origin of last resort; anchors are optional.
