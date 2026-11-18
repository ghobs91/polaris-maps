# 0001. Desktop relay is the primary seeder; phones seed only as a fallback

- **Status:** proposed
- **Date:** 2026-02-14

## Context

Every device currently seeds every region pack it downloads (`autoSeedRegion` in
`downloadService.ts` → `seedRegion`). The only thing that ever stops a device
seeding is deleting the region.

The measured availability of a phone seeder is poor by construction:
`seedDiagnostics.ts` exists to quantify it and its header states the premise —
"iOS suspends backgrounded apps, so a phone is a weaker seed than a desktop
BitTorrent client". `docs/scaling-p2p.md` records the same conclusion and the
experiment that would confirm it. In practice a pack's first copy therefore
still comes from GitHub Releases, which is the egress that packs exist to
remove.

Costs of the current arrangement, paid by the mobile user:

- a 50–400 MB pack seeded from a cellular plan and a battery budget,
  for an audience the device can only serve while foregrounded.

Costs of not having an always-on seeder, paid by the network:

- no participant whose job is to be online, so "peer-to-peer distribution"
  degrades to "CDN with a fallback path".

Two constraints shape any fix: iOS grants minutes of background execution, not
hours, so the phone cannot be the always-on node; and a Mac App Store app cannot
register background agents or accept inbound peer connections, so an
always-on desktop seeder cannot ship through the Mac App Store.

## Decision

1. **Role split.** Region packs (large, immutable, rarely changing) are seeded
   primarily by a desktop relay. Phones consume them and seed only as a fallback
   for regions no relay covers. Traffic probes, conditions, and tiles (small,
   latency-critical, constantly changing) stay device-to-device with no relay
   requirement.

2. **The relay is a background service, not an app.** A per-user `LaunchAgent`
   runs a headless Node daemon that seeds read-only canonical replicas over
   Hyperswarm/Hyperdrive. It starts at login, restarts on crash, and keeps
   seeding when the Polaris Maps app is quit. Quitting the relay's **own** UI
   stops everything: the daemon unseeds, exits 0, and the launch agent is
   unloaded and disabled so it does not return at the next login. Two different
   intents, so the two must not share a Quit: quitting a map app is not a request
   to stop seeding, and quitting the seeder's window is.

3. **Seed logic is shared, not duplicated.** The seeding rules move into a
   runtime-agnostic `backend/seed-core.mjs` (injected `fs`/`path`/swarm); the
   Bare worklet and the Node daemon are both thin adapters, following the
   precedent set by `backend/pmtiles.mjs` and `backend/shard-answer.mjs`.

4. **The user can always stop it.** Quitting the relay's menu-bar app ends
   seeding and disables the agent; nothing continues uploading after a Quit. A
   background service that keeps running after the user closes its own window is
   the hostile pattern this design exists to avoid.

5. **Phones learn about coverage from signed announcements**, published on the
   existing Gun.js gossip channel and verified with the existing identity
   primitives. Announcements carry availability only; content trust remains the
   canonical drive key plus the signed manifest plus per-asset verification.

6. **The relay is distributed outside the Mac App Store** (Developer ID,
   notarized) because the App Store sandbox forbids this shape.

7. **Polaris operates no relay.** The project ships the software; relays are
   user-run. This keeps the rule already stated in `docs/scaling-p2p.md`.

## Consequences

**Good**

- A phone covered by a relay stops spending data and battery on pack seeding,
  and knows it before it starts.
- Pack availability no longer depends on someone's phone being awake, which is
  the difference between a mesh and a fallback path.
- The relay is a pure availability multiplier: read-only replicas cannot forge
  content, so no trust or reputation model is needed to accept bytes from one.
- A LAN relay also removes the phone's cold-start traffic-tile cascade if the
  optional tile-serving phase lands.

**Bad / accepted**

- Two release channels: the relay cannot ship in the Mac App Store, so macOS
  distribution is a notarized direct download with its own install story.
- A second runtime for the same protocol — Node and Bare — with the drift risk
  that implies. Mitigated by a parity script, not eliminated.
- The project now maintains a process supervisor, a control protocol, and a
  budget model, plus the support questions they generate ("why did my Mac stop
  seeding").
- A user can have two seeders on one LAN; harmless to the swarm, but it makes
  "how many seeders are there" a question that needs the role distinction
  recorded in diagnostics.

## Alternatives Considered

- **Background seeding from the iOS app.** iOS grants minutes of execution, not
  hours. Rejected on platform limits; it does not produce an always-on node.
- **A Polaris-operated seeding fleet.** It is a CDN, it is project-funded
  infrastructure, and it contradicts both the DePIN premise and the existing
  "Polaris never operates a relay" rule.
- **An Electron desktop app that seeds while open.** Dies when the user quits,
  which is the exact lifecycle failure being fixed. The daemon/controller split
  costs one extra process and removes the class of problem.
- **Duplicate the seed implementation in Node rather than extract a core.**
  Fastest to a demo; the failure mode is silent divergence in the canonical-key
  and read-only rules between the device that downloads and the device that
  serves — the source of two past distribution bugs.
- **Infer relay coverage from swarm connections instead of signed
  announcements.** A connection cannot distinguish a Mac from a phone, and the
  entire client policy depends on that distinction.

## References

- `openspec/changes/add-desktop-relay-seeder/` — proposal, design, tasks, spec
- `src/services/sync/seedDiagnostics.ts` — why seeding must be measured
- `docs/scaling-p2p.md` — scaling analysis, volunteer-origin policy
- `backend/hyperdrive.mjs`, `src/services/sync/hyperdriveBridge.ts` — today's
  seeding path
