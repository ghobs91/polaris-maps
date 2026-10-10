## Why

Region packs (vector tiles, Overture-derived places, routing/geocoding assets) are how the app works offline, and the project's goal is to distribute them peer-to-peer. Today that path cannot work: `handleHdSeed` in the Node sidecar does `new Hyperdrive(store)`, creating a brand-new writable drive with a **unique key per device**, so every seeder advertises a different discovery key. The only place that could advertise a shared key — the region catalog — is a central CDN with no key field (`catalogService.ts` → `REGION_CATALOG_URL`), and `tryPeerDownload` is gated on a `driveKey` that is always null on a fresh install. Net: peers can never find each other, and first-copy distribution depends entirely on a Polaris-hosted origin. This is migration step 1 of the decentralization plan: make packs content-addressed and seedable by everyone.

## What Changes

- Region packs become **content-addressed**: one canonical read-only Hyperdrive per `(region, data version)` whose `key` / `discoveryKey` are identical for every seeder.
- Add a **signed region manifest** as the trust root and key source: `{ regionId, version, overtureRelease, driveKey, discoveryKey, contentHash, bytes, publisherPubkey, signature }`. A default manifest is bundled in the app; remote catalog entries may carry the same fields. Manifests are verified with the existing secp256k1 identity before a key is trusted.
- `hd-seed` accepts an optional canonical `key`: when present it opens a **read-only Hyperdrive clone** and replicates it (all seeders share the discovery key); when absent it creates the canonical drive once (publisher path) and returns the key + derived manifest.
- Seed-on-download replicates the canonical read-only drive instead of creating a new writable one.
- `regions.drive_key` stores the **canonical** key; downloads use it to pull from any seeder.
- **BREAKING (data)**: `drive_key` semantics change from "this device's private drive" to "the canonical pack key"; previously stored per-device keys are no longer valid and are replaced on next seed.

Explicitly out of scope for this change (later steps): monthly delta feeds, multi-publisher quorum, live-viewport P2P serving, and Gun.js manifest gossip.

## Capabilities

### New Capabilities

- `region-pack-distribution`: Content-addressed region packs identified by a canonical Hyperdrive key, advertised through a signed region manifest, seeded read-only by all peers, and discoverable on the swarm through the canonical discovery key.

### Modified Capabilities

<!-- None — no existing spec covers region pack distribution. -->

## Impact

- **Native sidecar**: `nodejs-assets/nodejs-project/index.js` (`hd-seed` clone/publish paths, canonical discovery-key join).
- **Bridge**: `src/services/sync/hyperdriveBridge.ts` (`seedRegion` gains a canonical-key/manifest parameter; returned key is canonical).
- **Regions**: `src/services/regions/downloadService.ts` (`autoSeedRegion`, `tryPeerDownload`), `src/services/regions/catalogService.ts` (bundled + remote manifest merge, signature verify), `src/models/region.ts` / `regionRepository.ts` (canonical key storage).
- **New**: region-manifest type, signature verification (reuse `src/services/identity/`), and a bundled default manifest constant.
- **Tests**: unit coverage for manifest verification (valid/tampered/unknown publisher), canonical seed plumbing (key passed through to the sidecar), and the fresh-install P2P gate.
- **Not hosted**: no new Polaris server; Overture's public mirrors remain the origin of last resort.
