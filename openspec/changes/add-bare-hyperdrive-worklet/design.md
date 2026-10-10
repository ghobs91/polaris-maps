## Context

`hyperdriveBridge.ts` speaks a JSON request/response protocol over `NativeModules.NodeChannel` (a `nodejs-mobile` sidecar). That runtime was never integrated — no dependency, no pod, no bundle wiring — so the bridge is dead. Meanwhile `react-native-bare-kit` runs a Bare worklet for traffic (`backend/traffic-swarm.mjs`, built by `bare-pack` into a committed `.bundle.mjs`, driven by `bare-rpc` numeric commands in `src/services/traffic/hyperswarmBridge.ts`). The `backend/` directory is a self-contained npm package (`type: module`) with its own `node_modules` because `bare-pack` needs a node-style resolver layout.

## Goals / Non-Goals

**Goals:**

- A working Hyperdrive runtime for region packs, hosted in Bare.
- Preserve the existing `hyperdriveBridge` public API so `downloadService` is unchanged.
- Seed (author / read-only), download-from-peers with progress, status, unseed.
- A committed, reproducible bundle built by `bare-pack`.

**Non-Goals:**

- The other `NodeChannel` consumers (node gunzip/tar, attestations).
- Removing `nodejs-assets/`.
- Changing the manifest/trust design (steps 1–2).

## Decisions

**D1 — Dedicated Hyperdrive worklet, not an extension of the traffic worklet.** Separate entry `backend/hyperdrive.mjs` and separate bundle keep concerns, lifecycles, and bundle sizes independent, and avoid coupling region I/O to the traffic mesh. `react-native-bare-kit` supports multiple `Worklet` instances.

**D2 — Storage backend.** `Corestore` rooted at `${documentDirectory}/.polaris-corestore`, one sub-store per region (mirroring the existing layout). Use the storage module that resolves cleanly under `bare-pack` for Bare (start with `random-access-file`; fall back to a `bare-fs`-backed store if resolution fails). Pin during implementation by getting `bare-pack` to build.

**D3 — Numeric RPC protocol mirroring today's `hd-*` commands.** RN → worklet: `HD_SEED`, `HD_DOWNLOAD`, `HD_STATUS`, `HD_UNSEED`. Worklet → RN: `HD_DOWNLOAD_PROGRESS`, and error/result replies reuse `bare-rpc`'s correlation. JSON payloads (kept simple; the packs are file bulk, not chatty).

**D4 — Preserve the bridge API.** `bareHyperdriveBridge` exports the same operations; `hyperdriveBridge.ts` delegates to it. Callers (`downloadService`) don't change.

**D5 — Graceful degradation.** If `react-native-bare-kit`/the bundle is unavailable (Jest, non-native), the bridge no-ops like today rather than throwing at import.

**D6 — File paths stay docDir-relative**, passed from RN to the worklet (same contract as the old sidecar: `filesDir`, `destDir`), with the worklet enforcing that writes stay under the app documents dir.

## Risks / Trade-offs

- **[Hyperdrive/Corestore may not bundle cleanly for Bare]** → Build with `bare-pack` first thing; if a module pulls node builtins, add an `imports.cjs` override (the traffic bundle already overrides `@noble/hashes/crypto`).
- **[Two Bare runtimes (traffic + hyperdrive)]** → acceptable; Hyperdrive has a distinct lifecycle and can be started lazily on first region download.
- **[On-device runtime differences (fs, DHT)]** → verified by a device smoke test; locked behind graceful degradation so it can't break app startup.
- **[Bundle size]** → `hyperdrive`/`corestore` add weight; the bundle is a single committed file like the traffic one.

## Migration Plan

1. Add worklet deps to `backend/package.json`; implement `backend/hyperdrive.mjs`; get `bare-pack` to emit `backend/hyperdrive.bundle.mjs`.
2. Add `bareHyperdriveBridge.ts`; rewire `hyperdriveBridge.ts`.
3. Add the `hyperdrive:bundle` script; commit the bundle.
4. Device smoke: author `us-ny-new-york`, then seed + download between two devices.
5. Rollback: `hyperdriveBridge` can revert to no-op if the worklet fails to start.

## Open Questions

- Exact storage module/version that resolves under `bare-pack` for Bare (`random-access-file` vs a `bare-fs` store).
- Whether the worklet should be started eagerly with traffic or lazily on first region download (lean lazy).
- Whether `downloadFromPeers` should keep the 30 s peer-wait from the old sidecar.
