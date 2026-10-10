## 1. Region manifest (model + trust)

- [x] 1.1 Add a `RegionManifest` type and canonical field list (`regionId`, `version`, `overtureRelease`, `driveKey`, `discoveryKey`, `contentHash`, `bytes`, `publisherPubkey`) in a new `src/services/regions/regionManifest.ts`
- [x] 1.2 Implement `buildRegionManifest()` (canonical serialization via `createSigningPayload`) and `verifyRegionManifest()` reusing `verify()` from `src/services/identity/signing.ts`
- [x] 1.3 Define `contentHash` (sorted file list + byte sizes) and a helper to compute it from a pack directory
- [x] 1.4 Add the trusted publisher public-key allowlist (bundled constant) and a `isTrustedPublisher(pubkey)` helper
- [x] 1.5 Unit tests: valid manifest accepted; tampered `driveKey` rejected; unknown publisher rejected

## 2. Bundled manifest + catalog merge

- [x] 2.1 Add the bundled default manifest constant (initially empty or one pilot region) with a `getBundledManifest(regionId)` lookup
- [x] 2.2 Extend the catalog entry schema with optional manifest fields; verify signatures and merge bundled-first / verified-remote-only in `catalogService.ts`
- [x] 2.3 Ensure the offline fresh-install path exposes canonical keys from the bundled manifest (MMKV cache + bundled fallback)
- [x] 2.4 Unit tests: remote entries extend the bundled manifest; unverified remote entries are ignored and never override a trusted entry

## 3. Node sidecar canonical seeding

- [x] 3.1 `hd-seed` accepts an optional canonical `key`: open a read-only Hyperdrive clone, replicate, join the canonical discovery key, and stay seeded with no writes
- [x] 3.2 Publisher path (no `key`): create the canonical writable drive, import files, join the swarm, and return `{ key, discoveryKey, contentHash }`
- [x] 3.3 Return the canonical key + discovery key from both paths; keep `hd-unseed` / `hd-status` correct for clones
- [ ] 3.4 Manual check: two sidecar instances seeded with the same canonical key report the same discovery key

## 4. Bridge + download flow

- [x] 4.1 `seedRegion(regionId, filesDir, canonicalKey?)` in `hyperdriveBridge.ts` passes the key through and surfaces the canonical key + manifest fields
- [x] 4.2 `autoSeedRegion` in `downloadService.ts` stores the canonical `drive_key` and records/emits a manifest when authoring a pack
- [x] 4.3 Fix the `tryPeerDownload` gate (`downloadService.ts:152`) so a known canonical key attempts P2P before the origin
- [x] 4.4 Unit tests: canonical key is passed to the sidecar; fresh install with a manifest key attempts P2P first (bridge mocked)

## 5. Storage & upgrade

- [x] 5.1 Treat legacy per-device `drive_key` values as stale: unseed the old drive and re-seed read-only against the canonical key on next use
- [x] 5.2 Align `regionRepository` / region model comments and `drive_key` docs with canonical semantics

## 6. Verification

- [x] 6.1 Run `pnpm typecheck && pnpm lint && pnpm format:check`
- [x] 6.2 Run the targeted Jest suites for the manifest + seeding changes and report actual results
- [x] 6.3 Update `src/services/regions/README.md` and `src/services/sync/README.md` for canonical seeding
- [ ] 6.4 Manual smoke: seed a region on one device/sim, discover and download it on a second via the canonical key
