## Why

The region-pack Hyperdrive path (`src/services/sync/hyperdriveBridge.ts`) calls `NativeModules.NodeChannel`, but no such native module exists: there is no `nodejs-mobile` dependency, no pod, and `nodejs-assets/nodejs-project/` is never loaded. Every call (`seedRegion`, `downloadFromPeers`, `unseedRegion`) therefore rejects with `NodeChannel not available` — region P2P seeding has never run, so step 1's canonical seeding is inert and the `us-ny-new-york` pilot cannot produce a real `driveKey`.

The app already runs a working P2P runtime: `react-native-bare-kit` hosts a Bare worklet (`backend/traffic-swarm.mjs` → committed `backend/traffic-swarm.bundle.mjs`) with `bare-rpc`. Hyperdrive/Hyperswarm are Holepunch's native stack and run on Bare. Host Hyperdrive in a Bare worklet instead of reviving the dead Node sidecar.

## What Changes

- Add a dedicated Bare worklet `backend/hyperdrive.mjs` (+ committed `backend/hyperdrive.bundle.mjs`) hosting `Corestore` + `Hyperdrive` + `Hyperswarm`, keyed per region, with the author (writable) and read-only replica paths from step 1.
- Add the worklet's dependencies (`hyperdrive`, `corestore`, storage) to `backend/package.json` and a `pnpm hyperdrive:bundle` script (bare-pack).
- Add the RN bridge `src/services/sync/bareHyperdriveBridge.ts` (Worklet + `bare-rpc`) exposing the same operations the app uses today: seed (author / read-only), download-from-peers with progress, status, unseed.
- Rewire `hyperdriveBridge.ts` to the Bare bridge; the dead `NodeChannel` calls are removed from this path.
- Public API of `hyperdriveBridge` (`seedRegion` / `downloadFromPeers` / `unseedRegion` / `getHyperdriveStatus`) is preserved, so `downloadService` and callers are unchanged.

Out of scope: the other `NodeChannel` paths (node `gunzipViaNode`, node tar extract, attestation publish) — they get their own follow-up; and deleting the unused `nodejs-assets` sidecar.

## Capabilities

### New Capabilities

- `region-pack-transport`: P2P transport for region packs over a Bare worklet — author/seed a canonical Hyperdrive, download a pack from peers with progress, query status, and unseed, surfaced through a React Native bridge that degrades gracefully when the runtime is unavailable.

### Modified Capabilities

<!-- None. region-pack-distribution / region-manifest-gossip are unarchived changes. -->

## Impact

- **Worklet**: `backend/hyperdrive.mjs` (new), `backend/hyperdrive.bundle.mjs` (new, committed), `backend/package.json` (+ deps), bundling via `bare-pack`.
- **RN**: `src/services/sync/bareHyperdriveBridge.ts` (new), `src/services/sync/hyperdriveBridge.ts` (rewired).
- **Consumers unchanged**: `src/services/regions/downloadService.ts` via the preserved `hyperdriveBridge` API.
- **Scripts**: `package.json` `hyperdrive:bundle`.
- **Tests**: RN bridge unit tests (mocked Worklet/RPC); the worklet bundle is validated by a successful `bare-pack` build.
