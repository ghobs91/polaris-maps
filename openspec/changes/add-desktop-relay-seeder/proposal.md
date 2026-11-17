## Why

The mesh has a seeder problem that the app cannot solve from a phone. `docs/scaling-p2p.md` already states it: "iOS suspends backgrounded apps, so a phone is a weaker seed than a desktop BitTorrent client", and `seedDiagnostics.ts` exists purely to measure how weak. Every device currently seeds every pack it downloads (`autoSeedRegion` → `seedRegion`), which means:

- A phone seeds a 50–400 MB pack from its own cellular plan and battery, for an audience it can only serve while foregrounded and awake.
- Availability collapses when the app is backgrounded, which is most of the time, so a second phone typically downloads from GitHub Releases instead of a peer — the exact egress that packs exist to remove.
- There is no participant in the network that is _supposed_ to be always-on. A decentralized distribution system where no node is ever reliably online is a CDN with extra steps.

A user's Mac is the natural answer: mains power, no thermal/suspension budget, a permanent disk, and usually the same LAN as the phone it would serve. This change makes the desktop the **primary seeder** of heavy artifacts (region packs, and later traffic tiles) and demotes phones to on-demand consumers that seed only when no relay covers them.

The desktop component must survive the app being closed. A menu-bar app that seeds only while its window exists would reproduce the phone's problem at desktop scale: the service is the product, the UI is a controller.

## What Changes

- **New artifact: `polaris-relay`** — a headless Node seeding daemon that replicates canonical region packs read-only over Hyperswarm/Hyperdrive, exactly as the Bare worklet does today. Distributed outside the Mac App Store (Developer ID + notarized), installed as a per-user `LaunchAgent` so it starts at login and restarts on crash **independently of the Polaris Maps app lifecycle**.
- **Seed core extracted from the Bare worklet.** The seed/status/unseed logic in `backend/hyperdrive.mjs` (`ensureSwarm`, `handleSeed`, `handleStatus`, `handleUnseed`, store lifecycle) moves into `backend/seed-core.mjs` with `fs`/`path`/swarm injected — the same pattern `pmtiles.mjs` already uses to run under both Bare and Node. The worklet becomes an RPC adapter; the relay becomes a Node adapter.
- **Control plane is local-only.** A mode-0600 Unix socket in the relay's Application Support directory. The menu-bar app and `polaris-relay ctl` are both just clients. No inbound TCP port is opened, so the relay is not a service anyone can reach without being on the swarm.
- **Signed relay announcements.** A relay publishes `{ relayPubkey, regions[], capacity, usage, lastSeen, signature }` on the existing Gun.js manifest-gossip channel, verified with the existing `verify()`. Phones learn that a relay covers a region without a new server.
- **Phones stop seeding by default when a relay covers the region.** New pure policy `relaySeedingPolicy.ts` decides local seeding from relay health, power, link metering, and free disk. Seeding on a phone becomes a _fallback for uncovered regions_, not the default, which is the data and battery saving this change is for.
- **Storage and egress budgets are explicit.** Disk budget with demand-driven LRU eviction, egress cap, pause on battery / Low Power Mode / metered ("expensive") interfaces, bounded concurrent peer connections. Seeding on **battery is off by default but user-enableable**; the region pinned by default is **the region the device is currently in**.
- **The menu-bar controller is part of this change**, not a follow-up: it reads and commands the daemon over the local socket and never owns the seeding process.
- **Relay-aware download policy.** `peerDownloadPolicy.ts` and the download UI learn the difference between "some phone might have it" and "a relay is seeding it right now".

## Capabilities

### New Capabilities

- `desktop-relay-seeder`: An always-on desktop seeding service for canonical region packs — lifecycle, budgets, local control plane, and signed availability announcements — plus the client-side policies that prefer it over a phone seeder.

### Modified Capabilities

- `region-pack-distribution`: seeding responsibility becomes role-based (relay preferred, phone fallback) instead of every device seeding everything it holds.

## Impact

- **New app**: `relay/` workspace package (Node 22, no React Native): daemon entry, launchd plist template, installer, control-socket client, CLI.
- **Backend**: `backend/seed-core.mjs` (new, runtime-agnostic), `backend/hyperdrive.mjs` reduced to an RPC adapter, `pnpm swarm:bundle`-equivalent rebuild for the worklet bundle.
- **Client (`src/`)**: new `src/services/relay/` (announcement model + verification + gossip read), `src/services/regions/relaySeedingPolicy.ts`, edits to `downloadService.ts` (`autoSeedRegion`), `peerDownloadPolicy.ts`, `seedDiagnostics.ts` (role-aware frames).
- **Gun.js**: read path for `polaris/relays/*` (write path lives in the relay, which runs its own Gun peer).
- **Distribution**: direct `.dmg`/`.pkg` + notarization, outside the Mac App Store — an App Store build cannot ship a background agent, so the two distribution channels differ for this component.
- **Not required**: no Polaris-operated server, no new third-party infrastructure, no change to how packs are built or signed.
- **Risk to the mesh**: a phone-only network must still work. Relay-preference is a policy tier, not a hard dependency; uncovered regions fall back to today's behaviour.
