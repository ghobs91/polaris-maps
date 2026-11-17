## 1. Seed core extraction (no new app yet)

- [x] 1.1 Create `backend/seed-core.mjs` exporting `createSeedCore({ fs, path, createSwarm, root })` with `seed`, `unseed`, `status`, `destroy` — moving `ensureSwarm`, `getStore`/`closeStore`, `corestorePath`, `handleSeed`'s body, `handleStatus`, and `handleUnseed` out of `backend/hyperdrive.mjs`
- [x] 1.2 Keep the read-only/authorship rule identical: a supplied `key` opens `new Hyperdrive(store, key)` and never writes; no key authors the drive and returns `{ key, discoveryKey, contentHash, bytes }`
- [x] 1.3 Preserve the existing single-swarm behaviour (one `Hyperswarm`, every connection replicates every seeded store) and the store-file-lock handling, with a comment recording the failure it prevents
- [x] 1.4 Reduce `backend/hyperdrive.mjs` to an RPC adapter over the core (`bare-fs`/`bare-path` injected), leaving the shard-query protocol in place
- [x] 1.5 Inject the swarm so a host can attach connection accounting without forking seeding rules
- [x] 1.6 Add `scripts/verify-seed-parity.mjs` (shape of `scripts/verify-shard-answer.mjs`): seed a fixture pack through the core under Node, download it through the RN bridge in a simulator, assert identical files and `contentHash`
- [x] 1.7 Rebuild and commit `backend/hyperdrive.bundle.mjs` (`pnpm swarm:bundle` equivalent), then confirm a region download+seed on device is unchanged
- [x] 1.8 Unit tests for the pure parts of the core (status shape, unseed idempotency, key/readOnly derivation)

## 2. Relay daemon

- [x] 2.1 Add the `relay/` workspace package (Node 22, no React Native): `serve`, `ctl`, and a `--once` self-check mode
- [ ] 2.2 `relay/src/seed-node.mjs` — the Node adapter over the seed core, with `node:fs`/`node:path` and its own swarm
- [x] 2.3 `relay/src/store.mjs` — pack store layout (`packs/<regionId>/<version>/`, `corestore/<regionId>/`), manifest verification before a pack is seeded, disk-budget refusal above the budget
- [x] 2.4 `relay/src/demand.mjs` — per-drive request accounting and LRU-by-demand eviction (30-day idle threshold), never evicting a pinned region
- [x] 2.5 `relay/src/budgets.mjs` — egress token bucket, monthly counter persisted to `state/usage.json`, concurrency and per-peer rate caps
- [x] 2.6 `relay/src/power.mjs` — `pmset`-derived AC/Low Power Mode and expensive/constrained path detection, feeding the pause matrix
- [x] 2.7 `relay/src/control.mjs` — `control.sock` at `0600` in a `0700` directory, peer-uid check, newline-delimited JSON `status`/`pin`/`unpin`/`set-budget`/`pause`/`resume`/`verify-pack`
- [x] 2.8 `polaris-relay ctl` client + `seed --from <dir>` for the development path
- [x] 2.9 `pnpm relay:dev` script that runs the daemon against a scratch directory with no launchd involvement
- [x] 2.10 Tests: budget enforcement (refuse above disk budget, stop at egress cap), eviction ordering, control-socket auth rejects a foreign uid, `seed --from` seeds a real built pack

## 3. launchd lifecycle and packaging

- [x] 3.1 `relay/launchd/app.polarismaps.relay.plist.template` — `RunAtLoad`, `KeepAlive{SuccessfulExit:false}`, `ProcessType=Background`, `LowPriorityIO`, `ThrottleInterval=30`, log paths
- [ ] 3.4 Verify the daemon survives: app quit, app force-quit, logout/login, and a `kill -9` (launchd restart) — **not yet run on a real login session**
- [x] 3.2 `relay/launchd/install.sh` / `uninstall.sh [--purge]`, following the shape of `scripts/host-deploy/` (installed copy is what runs; re-run the installer after changes)
- [ ] 3.3 Log rotation for `~/Library/Logs/Polaris Relay/` (or documented `newsyslog` config)
- [ ] 3.4 Verify the daemon survives: app quit, app force-quit, logout/login, and a `kill -9` (launchd restart)
- [ ] 3.5 Verify `ctl stop` stays stopped (no KeepAlive loop) and `ctl start` reloads the agent
- [ ] 3.6 Notarization + hardened runtime: Developer ID signing, `com.apple.security.cs.allow-jit` entitlement for the embedded Node runtime, `spctl --assess` and a clean-machine install check
- [ ] 3.7 `docs/relay.md` — what the relay is, install/uninstall, every budget, what it does and does not do, and why it is not in the App Store

## 4. Availability announcements and client policy

- [x] 4.1 Announcement model + canonical signing payload (`src/services/relay/announcement.ts`), verifying with the existing `verify()`/`createSigningPayload`
- [x] 4.2 `src/services/relay/announcementGossip.ts` — Gun read path at `polaris/relays/<relayPubkey>`, verify-before-merge, bounded MMKV persistence, TTL 30 min, in the shape of `regionManifestGossip.ts`
- [ ] 4.3 Relay-side publisher: own identity, 5-minute refresh, region list from the pack store, usage/capacity fields
- [x] 4.4 `src/services/regions/relaySeedingPolicy.ts` — pure `shouldSeedLocallyOnDevice` with the D8 rule order, returning `{ seed, reason }`
- [x] 4.5 `autoSeedRegion` consults the policy; unseeding on newly healthy relay coverage is scheduled, not immediate
- [ ] 4.6 Settings surface: `Seed this device` → `auto | always | never`, with the reason string shown ("Seeding handled by your Mac: <relay name>")
- [x] 4.7 `peerDownloadPolicy.ts` becomes relay-aware: relay announcement ⇒ P2P first; no relay ⇒ today's conservative behaviour
- [ ] 4.8 `seedDiagnostics.ts` records the device role (relay-covered consumer vs seeder) so the availability experiment distinguishes them
- [ ] 4.9 Tests: policy truth table (`never`/`always` overrides, covered+healthy, covered+unreachable, uncovered, disk-short, metered, battery); announcement signature valid/tampered/expired/unknown; peer-policy relay awareness

## 5. Menu-bar controller (outside the App Store)

- [x] 5.1 SwiftUI menu-bar app: state (seeding / paused + reason / capped), served-today, coverage list
- [x] 5.2 Pin/unpin regions, set budgets, pause/resume — all via the control socket, never by managing the process
- [x] 5.3 Quit behaviour: the app is a controller; quitting it leaves the agent loaded (state this in the UI)
- [x] 5.4 First-run: explain what the relay does, defaults, and the "Polaris never operates a relay" framing
- [ ] 5.5 Notarized `.dmg` with a documented install path from `docs/relay.md`

## 6. Traffic tile serving (last, optional on value)

- [ ] 6.0 **Deferred deliberately.** The tile protocol lives inside the 749-line
      traffic worklet and tile requests go to peers joined on geohash cell topics,
      so a relay would have to decide which cells to subscribe to — a design
      question, not a mechanical extraction. Not started.
- [ ] 6.1 Extract the tile request/response handler from `backend/traffic-swarm.mjs` into a shared module usable by both runtimes
- [ ] 6.2 Relay tile cache: `tiles/<z>/<x>/<y>.png`, 4 GiB budget, 3-hour freshness, LRU
- [ ] 6.3 Relay answers `requestTile` over the traffic swarm; per-peer rate cap still applies
- [ ] 6.4 Measure: cold-viewport tile paint on a phone with a LAN relay vs without; record both in `docs/scaling-p2p.md`
- [ ] 6.5 Keep the phone's own tile seeding unchanged (small and latency-critical, unlike packs)
