## 1. Worklet dependencies and entry

- [x] 1.1 Add `hyperdrive`, `corestore`, and the Bare-compatible storage module to `backend/package.json`; install
- [x] 1.2 Implement `backend/hyperdrive.mjs`: Corestore root under the passed documents dir, per-region sub-stores, Hyperswarm join, and RPC handlers `HD_SEED`, `HD_DOWNLOAD`, `HD_STATUS`, `HD_UNSEED`
- [x] 1.3 Implement the author path (writable drive from `filesDir`) and read-only replica path (clone by key), returning key + discovery key; compute content hash + bytes on author
- [x] 1.4 Implement download-from-peers with `HD_DOWNLOAD_PROGRESS` events and path-traversal guards
- [x] 1.5 Add `imports.cjs` overrides only if a dependency pulls node builtins (none needed — `bare-pack` resolved RocksDB + `bare-fs`/`bare-path`)

## 2. Bundle

- [x] 2.1 Get `bare-pack --host ios --host android --linked` to emit `backend/hyperdrive.bundle.mjs` (resolve module/Bare issues here first)
- [x] 2.2 Add a `hyperdrive:bundle` script to `package.json`; commit the generated bundle

## 3. React Native bridge

- [x] 3.1 Add `src/services/sync/hdRpcCommands.ts` with the numeric command/event IDs shared with the worklet
- [x] 3.2 Implement the Bare worklet bridge (Worklet + `bare-rpc`) in `hyperdriveBridge.ts`, mirroring the operations and progress events, with graceful no-op when the runtime is unavailable
- [x] 3.3 Add unit tests with `react-native-bare-kit` / `bare-rpc` mocked (seed author/read-only, download progress, status, unseed, unavailable no-op)

## 4. Rewire

- [x] 4.1 Rewrite `hyperdriveBridge.ts` onto the Bare worklet; remove the dead `NodeChannel` calls from this path while preserving the public API
- [x] 4.2 Confirm `downloadService` callers compile unchanged
- [x] 4.3 Start the worklet lazily on first region download; dispose on teardown

## 5. Verification

- [x] 5.1 Run `pnpm typecheck && pnpm lint && pnpm format:check`
- [x] 5.2 Run the new bridge unit tests and report actual results
- [ ] 5.3 Update `src/services/sync/README.md` and `src/services/regions/README.md` for the Bare Hyperdrive worklet
- [ ] 5.4 Device smoke: author `us-ny-new-york` on one device, seed it, download it on a second via the canonical key
