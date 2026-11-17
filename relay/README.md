# Polaris Relay

An always-on desktop seeder for the Polaris Maps P2P network.

The relay replicates **canonical region packs read-only** over Hyperswarm/Hyperdrive, so other devices (primarily phones) can download 50–400 MB packs from a machine on mains power instead of from GitHub Releases or from each other's data plans. It runs as a per-user launch agent: it starts at login, restarts after a crash, and **keeps seeding when the Polaris Maps app — or its menu-bar controller — is quit**.

- Why this exists and what it trades off: `docs/decisions/0001-desktop-relay-primary-seeder.md`
- Design, budgets, announcement format, phasing: `openspec/changes/add-desktop-relay-seeder/design.md`
- User-facing install and settings: `docs/relay.md`

## Layout

| Path               | What it is                                                       |
| ------------------ | ---------------------------------------------------------------- |
| `src/cli.mjs`      | `serve` (the daemon launchd runs) and the `ctl` commands         |
| `src/daemon.mjs`   | Wiring: pins, power, budgets, control socket, announcements      |
| `src/control.mjs`  | Local control plane — Unix socket, newline-delimited JSON        |
| `src/budgets.mjs`  | Egress accounting, monthly cap, token bucket                     |
| `src/demand.mjs`   | Per-drive demand and LRU-by-demand eviction                      |
| `src/power.mjs`    | `pmset` parsing and the pause matrix                             |
| `src/config.mjs`   | Defaults, validation, clamping                                   |
| `src/state.mjs`    | Pinned regions and usage counters (atomic JSON)                  |
| `src/announce.mjs` | Signed availability announcements                                |
| `launchd/`         | Agent template, installer, uninstaller                           |
| `controller/`      | SwiftUI/AppKit menu-bar controller (built with `swiftc`)         |
| `test/`            | `node --test` suites (pure modules + a socket-level daemon test) |

The seeding rules themselves are **not** here: they live in `backend/seed-core.mjs` and are shared with the Bare worklet on the devices, so the two runtimes cannot disagree about canonical keys or read-only replication.

## Development

```bash
# Everything in a scratch directory — never the real seed store.
POLARIS_RELAY_HOME=/tmp/polaris-relay-dev node relay/src/cli.mjs serve

# In another shell
POLARIS_RELAY_HOME=/tmp/polaris-relay-dev node relay/src/cli.mjs status
POLARIS_RELAY_HOME=/tmp/polaris-relay-dev node relay/src/cli.mjs pause
POLARIS_RELAY_HOME=/tmp/polaris-relay-dev node relay/src/cli.mjs resume
```

Tests (no network, no launchd, no real paths):

```bash
node --test relay/test/
node scripts/verify-seed-parity.mjs   # seed core parity under Node
```

Seed a locally built pack without a publisher (development only — this is the one
path that authors a writable drive):

```bash
node relay/src/cli.mjs seed --from work/us-ny-new-york us-ny-new-york
```

## Notes that are easy to get wrong

- **Nothing is seeded without a pin.** A pin carries a canonical `driveKey` from a
  signed region manifest; the relay opens a read-only replica and never authors.
  A pin without a valid key is dropped at load.
- **Pausing unseeds.** Keeping the swarm open while "paused" would still hold the
  discovery topics, so a phone would still count the relay as coverage.
- **The control socket is the only local surface**, and its access control is the
  containing directory (`0700`) plus the socket (`0600`). No TCP port is opened in
  any mode.
- **`pmset` is the only power signal** the daemon uses, because it needs no
  entitlements or native modules. Unknown power state is treated as battery.
