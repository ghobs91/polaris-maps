## Context

### What exists today

Seeding is implemented once, inside the Bare worklet. `backend/hyperdrive.mjs`:

- `ensureSwarm()` creates a single `Hyperswarm`; every connection replicates **every** seeded store (`for (const { store } of seededDrives.values()) store.replicate(conn)`) and then attaches the shard-query protocol.
- `handleSeed` opens one `Corestore` per region under `corestoreRoot/<regionId>`, then either `new Hyperdrive(store, key)` (**read-only canonical replica**) when a key is supplied, or authors the writable drive when it is not, `swarm.join(drive.discoveryKey)`, `await discovery.flushed()`, and records `{ drive, discovery, store, readOnly, contentHash, bytes, root }`.
- `handleStatus` returns `{ drives: [{ regionId, key, discoveryKey, peers }], swarmConnections }`; `handleUnseed` destroys the discovery and closes the store.

The client side is already canonical-key based: `seedRegion(regionId, filesDir, canonicalKey)` (`src/services/sync/hyperdriveBridge.ts`) passes the key from the signed region manifest, and `autoSeedRegion` (`src/services/regions/downloadService.ts:854`) calls it after **every** download, storing the canonical key in `regions.drive_key`. `unseedRegion` has exactly one caller — `deleteRegionData`. Nothing else ever stops a device seeding.

The consequences are measured, not assumed:

- `src/services/sync/seedDiagnostics.ts` samples `getHyperdriveStatus()` once a minute **while foregrounded**, records "seed availability" (fraction of samples where a drive had ≥1 peer), and caps its rolling window at 60 samples. Its own header states the premise: "iOS suspends backgrounded apps, so a phone is a weaker seed than a desktop BitTorrent client."
- `docs/scaling-p2p.md` says the same in the scaling analysis and prescribes the two-device foreground/background experiment that would confirm it.
- `peerDownloadPolicy.ts` documents the failure mode from the other side: with no reachable seeder, the P2P attempt burns `TRANSFER_TIMEOUT_MS` (120 s) before falling back to HTTP, and a reload inside that window leaves a half-downloaded region.

So the network has no participant whose job is to be online. Every pack is seeded by devices that are asleep, suspended, or on cellular, and first-copy distribution falls through to GitHub Releases — the egress that packs exist to eliminate.

### What is missing

1. An always-on seeder that does not depend on any app's UI lifecycle.
2. A way for a phone to know a relay covers a region, so it can decline to seed.
3. A way to stop paying the 120 s P2P penalty when nobody is actually seeding.

### Reusable building blocks

- **Canonical read-only replication** already works; the relay needs no new integrity model.
- **Runtime-agnostic module pattern**: `backend/pmtiles.mjs` is documented as running "in two places — the Bare worklet with `bare-fs` injected; Node, for the parity test, with `node:fs` injected", and `backend/shard-answer.mjs` is deliberately dependency-free so a Node script can diff its output against the TypeScript implementation. The seed core extraction below follows this established pattern rather than inventing one.
- **Signing**: `src/services/identity/signing.ts` (`sign`/`verify`/`createSigningPayload`, secp256k1) already signs and verifies region manifests; announcements reuse it.
- **Gossip channel**: `regionManifestGossip.ts` already does verify-before-merge on `polaris/region-manifests/<regionId>/<pubkey>` with bounded MMKV persistence.
- **Budgets**: `resourceManager.ts` already derives storage/bandwidth/battery ceilings from free disk and network type.

### Constraints

- The macOS app does not exist; `app.json` declares no macOS platform. This is greenfield on the desktop side.
- **App Store distribution cannot ship this.** A sandboxed Mac App Store app may not register background agents or accept inbound Hyperdrive connections. The relay has to be Developer ID + notarized, installed directly. That is consistent with the project's local-Fastlane, no-EAS-quota release stance, but it is a second distribution channel.
- Aligning with the existing rule in `docs/scaling-p2p.md`: **Polaris never operates a relay.** Relays are user-run. The project ships the software, not the service.

## Goals / Non-Goals

**Goals:**

- A user's Mac seeds region packs continuously — at login, across app quits, across app updates — with no UI open.
- A phone that is covered by a relay does **not** spend its own data or battery seeding, and knows that before it starts.
- The desktop component is optional: a phone-only network keeps working exactly as it does now.
- Seeding costs the desktop user a bounded, visible, revocable amount of disk and bandwidth.
- No new Polaris-operated infrastructure.

**Non-Goals (explicitly later):**

- Relay-to-relay churn balancing or a scheduler.
- Monetary incentives / proof-of-bandwidth.
- Windows or Linux relay builds (the core is Node, so they are a packaging task, not a design one).
- Acting as a DHT bootstrap node or a Nostr relay.
- Serving live-viewport Overture POIs from the relay (the shard protocol already gives phones that from any seeder, including a relay, with no change).

## Decisions

### D1 — Role split: desktop seeds heavy artifacts, phones consume them

| Artifact                    | Today                                  | After                                         |
| --------------------------- | -------------------------------------- | --------------------------------------------- |
| Region pack (50–400 MB)     | every device seeds everything it holds | relay seeds; phone seeds only if uncovered    |
| Traffic tiles (KB)          | phone seeds its 2 000-tile cache       | unchanged on phone; relay keeps a large cache |
| Traffic probes / conditions | phone-to-phone swarm + Nostr           | unchanged                                     |
| Region manifests            | Gun.js gossip                          | unchanged (relay also publishes)              |

The split follows the artifact's size and the participant's availability. Small, latency-relevant, constantly-changing data stays device-to-device; large, immutable, rarely-changing data moves to the only participant that is always awake.

_Alternative rejected:_ make the phone a better seeder with background refresh / BGTaskScheduler. iOS gives minutes, not hours, and every minute of seeding on cellular is the exact cost this change removes.

### D2 — Extract a runtime-agnostic seed core; worklet and relay become adapters

New `backend/seed-core.mjs` owns everything that is not IPC and not runtime-specific:

```js
createSeedCore({ fs, path, createSwarm, root }) => {
  seed({ regionId, filesDir, key }),   // read-only clone when key, else author
  unseed({ regionId }),
  status(),                            // drives + per-drive peers + connections
  destroy(),
}
```

`backend/hyperdrive.mjs` keeps only RPC command dispatch and shard protocol, calling the core with `bare-fs`/`bare-path`. `relay/src/seed-node.mjs` calls the same core with `node:fs`/`node:path`. The swarm is injected so the relay can attach its own connection accounting (D11) without forking the seeding rules.

Why not duplicate: the seeding rules are exactly the ones that must not diverge between the device that downloads a pack and the device that serves it — the canonical-key/read-only logic is already the source of two past distribution bugs (per-device keys, and `drive_key` that was always null). Two copies means two chances to reintroduce them.

Why not run the Bare worklet inside the relay: `bare-rpc` + `BareKit.IPC` is a React Native IPC contract, not a service API, and `react-native-bare-kit` is a native addon for iOS/Android. The relay is a Node process.

_Verification:_ a Node parity script in the style of `scripts/verify-shard-answer.mjs` that seeds a fixture pack through the core under Node, then downloads it with the existing React Native bridge in a simulator. Same bytes or the refactor is wrong.

### D3 — Lifecycle: a per-user `LaunchAgent`, not the app, not a daemon

`~/Library/LaunchAgents/app.polarismaps.relay.plist`:

| Key                                     | Value                                     | Why                                                     |
| --------------------------------------- | ----------------------------------------- | ------------------------------------------------------- |
| `ProgramArguments`                      | `…/Polaris Relay/bin/polaris-relay serve` | single foreground process, launchd supervises           |
| `RunAtLoad`                             | `true`                                    | starts at login, app not involved                       |
| `KeepAlive`                             | `{ SuccessfulExit: false }`               | restarts on crash, stays down on a clean `ctl stop`     |
| `ProcessType`                           | `Background`                              | throttled CPU/IO priority; never competes with the user |
| `LowPriorityIO`                         | `true`                                    | hashing/replication must not stall the desktop          |
| `StandardOutPath` / `StandardErrorPath` | `~/Library/Logs/Polaris Relay/*.log`      | diagnosable without a UI                                |
| `ThrottleInterval`                      | `30`                                      | a crash loop must not spin                              |

Not a `LaunchDaemon`: that runs as root, system-wide, before login, and has no business touching a user's files or bandwidth grants.

Not embedded in the app bundle's process tree: launching a child from the app gives a process the app's lifetime and its sandbox, and macOS will not restart it after the app quits — precisely the failure being fixed. The daemon holds its own Hyperswarm and Corestore handles in its own process, under its own user.

**Two different Quits, and they must not be conflated.** Quitting _Polaris Maps_ must not pause replication — that is the whole point of a separate seeder process, and a map app quitting is not a request to stop seeding. Quitting the **relay's own menu-bar app** must stop everything: it sends `shutdown` (which unseeds and exits 0, so `KeepAlive{SuccessfulExit:false}` leaves it down), then `launchctl bootout` and `disable` so it does not return at the next login, and the Quit item says so. A background service that keeps uploading after the user closes its own window is the hostile anti-pattern this project should not ship, and "you must remember a CLI incantation to stop it" is the same bug with extra steps.

**Sleep/power:** no native deps; poll `pmset -g ps` (source of power) and `pmset -g` (`lowpowermode`) once a minute, plus `NWPathMonitor` equivalents via a small helper for `isExpensive`/`isConstrained`. Replication pauses on battery or Low Power Mode by default (D11). The relay never requests wake — a laptop that sleeps seeds nothing, which is correct, and the LAN case resumes on wake without intervention.

### D4 — Storage layout, budgets, and demand-driven eviction

```
~/Library/Application Support/Polaris Relay/
  config.json                 # budgets, pinned regions, port-free
  packs/<regionId>/<version>/ # expanded pack: tiles/*.pbf, *.sqlite, routing graph
  corestore/<regionId>/       # Hyperdrive blocks (what peers actually replicate)
  tiles/<z>/<x>/<y>.png       # relay traffic-tile cache (D10)
  state/usage.json            # bytes served, per-drive last-requested
  control.sock                # D5
```

### Which regions a relay seeds

**Nothing is seeded until a region is pinned, and the default pin is the region
the device is currently in.** The relay does not decide this: the app already
knows where the user is (it auto-downloads that region's pack), so it pins its
current region to the relay as the user moves, and the relay seeds what it is
told. That is what makes "the packs I can actually reach are the ones being
seeded" true by construction instead of by guesswork, and it keeps the relay free
of geolocation and of any notion of which regions "should" be popular.

A pin carries the canonical `driveKey` from the signed region manifest. A pin
without a valid key is dropped at load rather than authored — the relay never
creates a competing pack.

Defaults for the rest, all user-editable and enforced before work starts:

| Budget           | Default             | Enforcement                                                                     |
| ---------------- | ------------------- | ------------------------------------------------------------------------------- |
| Pack store       | 25 GiB              | refuse new seed when adding it would exceed; never evict a pinned region        |
| Eviction         | LRU by **demand**   | a drive with no peer request for 30 days is evicted before one with traffic     |
| Tile cache       | 4 GiB               | LRU, 3-hour freshness window (vs the phone's 2 000 tiles / 15 min)              |
| Monthly egress   | 500 GB              | counted locally per calendar month; stop, do not throttle, so it is predictable |
| Burst rate       | 10 Mbit/s both ways | token bucket                                                                    |
| Concurrent peers | 32                  | refuse additional connections                                                   |
| Per-peer rate    | 2 Mbit/s            | protects the aggregate from one greedy client                                   |

The carrier has to be able to say no cheaply. A relay that quietly saturates an uplink gets uninstalled, and an uninstalled relay is worth less than no relay, because the phone's policy assumed coverage.

Note the pack is stored twice (expanded files for local serving answers + `corestore` blocks for replication). For a desktop with 25 GiB this is acceptable and mirrors the device layout; a single-copy design needs Hyperdrive range reads for the shard protocol, which is a separate change.

### D5 — Control plane: local Unix socket, no listening port

`control.sock`, mode `0600`, owning directory `0700`, `SO_PEERCRED`-equivalent check (on macOS: `LOCAL_PEERCRED` / `getpeereid`) that the peer uid is the owner uid. Newline-delimited JSON request/response:

```
{"cmd":"status"}                     → drives, peers, served bytes, budgets, paused reason
{"cmd":"pin","regionId":"us-ny-new-york"}
{"cmd":"unpin","regionId":"…"}
{"cmd":"set-budget","egressGb":250}
{"cmd":"pause"} / {"cmd":"resume"}
{"cmd":"verify-pack","regionId":"…"} → manifest + contentHash check
```

`polaris-relay ctl <cmd>` is a thin client over it, which is what makes the daemon testable and scriptable without the GUI. No TCP port is opened in any mode: the swarm is the only network surface, so there is nothing to firewall, scan, or authenticate remotely.

`ctl` also gets `seed --from <dir>` for the development path (seed a locally built pack without the app), which is how the parity test in D2 runs.

### D6 — Integrity: the relay can withhold or be slow; it cannot lie

Read-only canonical replicas only. The relay **never** authors a drive: authoring is the publisher path (`seedRegion` without a key) and stays in the app/CI tooling. Three properties follow, none of which need new code:

1. Hyperdrive blocks are ed25519-writer-signed — a replica cannot forge content for a key it does not hold.
2. `contentHash` in the signed region manifest lets any client verify the pack's derived payload.
3. Per-asset `md5` verification already exists in `assetDownload.ts`, so a pack served over HTTP and a pack served over the swarm are checked the same way.

So the relay is a pure availability multiplier with zero trust requirement. It also means there is nothing to authenticate about a relay's _content_, which is what makes D7's impersonatable announcement acceptable.

### D7 — Discovery: signed availability announcements on the existing gossip channel

A relay publishes to Gun.js every 5 minutes, TTL 30 minutes:

```jsonc
{
  "v": 1,
  "relayPubkey": "…", // ed25519, distinct from any phone identity
  "regions": [
    {
      "regionId": "us-ny-new-york",
      "version": "map-data-2026-01",
      "driveKey": "…",
      "bytes": 96468992,
    },
  ],
  "capacityBytes": 26843545600,
  "usedBytes": 7516192768,
  "uplinkKbps": 100000,
  "paused": false,
  "pausedReason": null,
  "servedBytes24h": 12884901888,
  "updatedAt": 1767225600,
  "publisherPubkey": "…",
  "signature": "…",
}
```

Path: `polaris/relays/<relayPubkey>`, verified with the same `verify()` + canonical-payload helper the manifests use, merged and persisted (bounded) exactly like `regionManifestGossip.ts`. An announcement is **availability metadata only** — it never carries content or a key that the client would trust for content. A forged announcement can therefore only make one phone schedule badly, never receive wrong bytes.

_Alternative rejected:_ a DNS or HTTP registry. That is a Polaris-operated service by another name, and `docs/scaling-p2p.md`'s rule is that Polaris does not operate one.

_Alternative rejected:_ infer relays from swarm connections. A connection cannot distinguish a Mac from a phone, and the whole point of D8 is to distinguish them.

### D8 — Client policy: seeding becomes a fallback for uncovered regions

New pure module `src/services/regions/relaySeedingPolicy.ts`, in the same shape as `peerDownloadPolicy.ts` and `packSourcePolicy.ts` (no native imports, unit-tested directly):

```ts
export function shouldSeedLocallyOnDevice(input: {
  relayCovers: boolean; // fresh signed announcement names this region
  relayHealthy: boolean; // …and it acknowledged the drive / served ≥ 1 KiB
  userPref: 'auto' | 'always' | 'never';
  power: 'charging' | 'battery';
  link: 'unmetered' | 'metered' | 'none';
  freeDiskRatio: number; // free / required
}): { seed: boolean; reason: string };
```

Rules, in order:

1. `never` → don't seed. `always` → seed (this is what makes the change revocable).
2. Relay covers **and** is healthy → don't seed. The phone is a consumer.
3. Relay advertised but unhealthy/unreachable → seed, but only `charging` + `unmetered` + enough disk.
4. No relay for the region → today's behaviour, so a phone-only mesh is unchanged.

`autoSeedRegion` consults this instead of seeding unconditionally, and `unseedRegion` is scheduled (not immediate) when a relay becomes healthy — scheduled so that a just-downloaded pack is not unseeded in the same breath as the download that needed the peer.

Traffic probes and conditions keep seeding always: they are tiny, latency-critical, and relay assembly would add a hop to the one thing that must stay direct.

### D9 — Download policy stops paying 120 s for a peer that isn't there

`peerDownloadPolicy.shouldTryPeerDownload` currently gates on `canonicalKey && (peersConnected || !hasHttpFallback)`. Two changes:

- With a **fresh relay announcement** for the region, attempt P2P first and treat it as the primary origin (it is the cheapest bytes and the whole point of the relay).
- Without one, keep the existing conservative behaviour but shorten the observed-attempt timeout, since `TRANSFER_TIMEOUT_MS` is 120 s and the documented failure is a user who reloaded mid-attempt.

The relaying peer is discovered by the canonical `discoveryKey` exactly as any seeder is, so this is a _scheduling_ change, not a transport change.

### D10 — Phase 5: the relay serves traffic tiles too

Phone cold-start traffic tiles are the other half of this change's motivation. Today a cold viewport pays a serialised disk → peer (≤1 200 ms after the accompanying traffic fix) → TomTom cascade and paints progressively. A relay on the same LAN can serve those tiles in single-digit milliseconds.

The wire protocol already exists (`requestTile` / `sendTileResponse` over the traffic swarm, `trafficTileService.ts` ↔ `backend/traffic-swarm.mjs`), and the payload is a size-capped base64 PNG. The relay runs the tile-request handler from a shared module and keeps a 4 GiB, 3-hour-freshness tile cache keyed `z/x/y` — no region affiliation needed, since a tile is a tile. Phones additionally get a _pre-warm_: a relay holding a viewport's tiles makes the cold-start case disappear for anyone on the same network.

Deliberately last: it is the only piece that touches the traffic worklet, and it should land after the pack path proves the core extraction.

### D11 — Egress etiquette and the pause matrix

| Condition                     | Pack replication      | Tile serving          |
| ----------------------------- | --------------------- | --------------------- |
| AC + unmetered                | on                    | on                    |
| AC + metered/expensive        | on if user opted in   | on if opted in        |
| Battery                       | paused (default)      | paused (default)      |
| Low Power Mode                | paused                | paused                |
| Sleep                         | not running           | not running           |
| Egress cap reached            | stopped for the month | stopped for the month |
| `ctl pause`                   | stopped               | stopped               |
| Lid closed + external display | per `pmset` state     | same                  |

Every pause has a `reason` string surfaced in `status` and the menu bar, because "why did my Mac stop seeding" is the support question this design will actually generate.

### D12 — Observability stays local

`ctl status --json`, a rolling in-memory summary, and `~/Library/Logs/Polaris Relay/`. Frame shape mirrors `seedDiagnostics.ts` (drives, connections, reachable drives, availability) plus served bytes per drive, so the phone and the relay can be compared in one experiment. **Nothing is uploaded.** Measuring distribution must not itself create traffic — the same rule `seedDiagnostics.ts` already states.

## Rollout phases

| Phase | Deliverable                                                                  | Gate                                                                      |
| ----- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 0     | `backend/seed-core.mjs` extracted, worklet is an adapter, Node parity script | existing download/seed paths still work; parity script green              |
| 1     | `relay/` daemon + `ctl`, `pnpm relay:dev`, seed from a directory             | a simulator the relay seeds a real region end-to-end                      |
| 2     | launchd install/uninstall, budgets, control socket, logs                     | survives logout/login and app quit; respects every budget                 |
| 3     | announcements + `relaySeedingPolicy` + `autoSeedRegion` change               | covered phone stops seeding; uncovered phone still seeds                  |
| 4     | menu-bar controller (SwiftUI, outside the App Store)                         | Quit stops seeding and disables the agent; Polaris Maps quitting does not |
| 5     | traffic tile serving                                                         | cold viewport from a LAN relay paints in < 1 s                            |

Each phase is independently shippable and none of them regress a phone-only network.

## Risks

- **Node/Bare behavioural drift.** Hyperdrive and Hyperswarm are the same packages under both runtimes, but Corestore locking and block layout differ in edge cases (the worklet already documents a store-file-lock failure). Mitigation: the Phase 0 parity script downloads from a Node-seeded drive through the RN bridge; nothing ships until that passes.
- **Notarization + hardened runtime.** A notarized Node binary needs `com.apple.security.cs.allow-jit` and either a signed `node` or an embedded `Electron`-free launcher; getting this wrong produces a relay that cannot start on a user's Mac. This is packaging work, and it is the most likely place to lose a week.
- **Two seeders on one LAN** (phone + relay, same pack) is harmless — the swarm deduplicates — but the _phone_ must not count another phone as a relay. Only signed announcements mark coverage (D7), which is why the announcement is signed at all.
- **Budget surprises.** Disk full or a metered month is a trust-destroying bug. The mitigation is sequential: refuse new work above the disk budget, stop at the egress cap, and never silently evict a pinned region.
- **MAC address / network privacy.** The relay is a long-lived peer on the user's network. It joins only drive discovery topics (nothing broadcast beyond hashes), and it does not open a port, but the traffic-tile phase means it accepts swarm connections continuously. Worth stating in the install UI.
- **Distribution split.** The macOS relay cannot be in the Mac App Store while the iOS app is; the download page has to explain what the relay is and why it is a separate install.
- **Relay becomes de-facto required** if pack origins are ever throttled and users expect relay-quality performance. Keep GitHub Releases as the guaranteed origin and treat relay preference as a policy tier.

## Alternatives Considered

- **Seed from the iOS app with background tasks.** iOS grants minutes; the problem is hours. Rejected on platform limits.
- **A Polaris-operated seeding VPS fleet.** It is a CDN, it is project-funded infrastructure, and it contradicts the DePIN premise and the "Polaris operates no relay" rule.
- **Make the desktop app an Electron app that seeds while running.** Dies when the user quits — the exact lifecycle being fixed. The daemon/controller split costs one extra process and removes the whole class of problem.
- **Ship the relay as a standalone CLI only, no menu bar.** Cheapest, but then budgets are invisible and "why is my Mac uploading" has no answer. The controller is small and pays for itself in support cost.
- **Skip the core extraction and write a second seeding implementation in Node.** Fastest to a demo, and the failure mode is silent divergence between the two things that must agree about canonical keys. Rejected, with `pmtiles.mjs` as the existing counter-example of how to do it properly.
