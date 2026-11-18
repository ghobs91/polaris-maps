# Polaris Relay (desktop seeding)

The Polaris Relay is an optional desktop companion that seeds map packs for other
devices on the network, so phones do not have to. It runs in the background on
your Mac, starts itself at login, and keeps seeding when you quit the Polaris Maps
app.

**Polaris does not operate this service.** The software is here; the machine and
the bandwidth are yours, and the budgets below are enforced locally.

## What it does

- Replicates the region packs you pin, read-only, so other devices can download
  them peer-to-peer instead of from GitHub Releases or from a phone on cellular.
- Publishes a signed "I am seeding these regions" announcement so a phone knows
  it can skip seeding that region itself.
- Serves nothing else. It cannot modify a pack, and it holds no account.

## What it never does

- **It never writes to a pack.** It only ever opens read-only replicas of a
  canonical pack key. Content is authenticated by that key, the signed region
  manifest, and per-asset checksums, so a relay can be slow or offline but it
  cannot serve altered bytes.
- **It opens no network port.** All peer traffic is Hyperswarm connections; the
  control plane is a Unix socket in your Application Support directory.
- **It does not seed on battery by default**, and does not seed on a tethered or
  metered connection by default. Both can be enabled.
- **It does not upload anything about you.** Usage counters stay in
  `state/usage.json` and the log file.

## Install

```bash
relay/launchd/install.sh          # daemon + menu-bar app, started now and at login
relay/launchd/uninstall.sh        # stop seeding, keep the seed store
relay/launchd/uninstall.sh --purge   # also delete packs, config, logs and the app
```

The installer does both halves, because a seeder with no visible presence is a
service you cannot tell is running — let alone stop. It loads the daemon agent,
builds the menu-bar app with `swiftc`, installs it to `~/Applications/Polaris
Relay.app`, registers it as a login item and opens it. An antenna icon in the menu
bar means it is installed; the icon's menu says whether it is serving and why not.

The menu-bar app is **not** part of the iOS app or its TestFlight build — an iOS
build cannot ship a macOS agent. `SKIP_CONTROLLER=1` skips that half if you only
want the daemon.

The installer records absolute paths (launchd does not read your shell profile),
so re-run it after moving the repository or changing Node.

v1 runs the relay from this checkout. A self-contained `.app`/`.pkg` with an
embedded Node runtime is tracked in the relay change's tasks.

## The macOS app

There is a real macOS app: a menu-bar icon with a dashboard window. It talks to the
daemon over the local control socket, so it needs no network, no Gun relay and no
iOS app — the two are on the same machine.

```bash
relay/controller/build.sh                      # build
open "relay/controller/build/Polaris Relay.app" # run the build output
```

`install.sh` does this for you: builds it, copies it to
`~/Applications/Polaris Relay.app`, registers it as a login item and opens it.

The dashboard covers the whole relay: serving state and pause reason, power, uptime,
what it served today, regions seeded (peers, size, last requested, unpin), budgets
(store limit, monthly upload cap, max peers), the battery/metered switches,
idle-drop, and the phones authorized to control it (with revoke). The window does
not open at login — the icon is there and the window is on demand.

`--selftest` exercises the socket client and the status decoding without a GUI,
which is how the install can be checked without clicking anything:

```bash
"$HOME/Applications/Polaris Relay.app/Contents/MacOS/PolarisRelay" --selftest
```

It shows whether the relay is serving, why it is paused, what it served today, and
which regions it holds; it can pause/resume and toggle seeding on battery.

**Quitting it stops the relay.** Seeding ends, the daemon exits cleanly, the launch
agent is unloaded and disabled so it does not come back at the next login, and the
menu says so on the Quit item. There is no hidden process left uploading. "Start
relay" in the same menu turns it back on (or re-run `relay/launchd/install.sh`).

What does _not_ stop the relay is quitting Polaris Maps — that is a different app
and a different intention, and it is the entire reason the seeder is a separate
process.

## Dashboard (Polaris Maps → Settings → Offline maps → Desktop relay)

The app can see and control a relay from anywhere: whether it is serving and why
not, which regions it seeds and how many peers each has, what it served today,
the budgets, and the battery/metered switches. "Seed this region here" pins the
pack for wherever the map is looking, which is the default pin rule wired to the
one place that knows your location.

Controls are **signed commands** sent over the Gun.js gossip channel the two
sides already share — the app never opens a socket to your Mac and no port is
exposed. Two consequences the UI states rather than hides:

- **A tap is not instantaneous.** Delivery is best-effort with seconds of latency,
  so a command shows as pending until the relay's signed ack arrives. "No answer
  yet" means exactly that: the command is still valid for 10 minutes and will be
  ignored after that if it never lands.
- **The channel needs a Gun relay.** If the public Gun pool is unreachable, the
  dashboard shows no relay and commands do not arrive, even though the relay is
  running on your Mac. The relay itself keeps seeding regardless — local control
  (`polaris-relay …`) never depends on Gun.

## Linking a phone (QR)

On the Mac: **Link a phone…** in the dashboard (or `polaris-relay pair`). It shows a
QR code carrying the relay's key and a one-time secret:

```
polaris://pair?relay=<64 hex>&secret=<32 hex>
```

On the phone: Settings → Offline maps → Desktop relay → **Link this phone…**, and
scan it. Scanning _is_ the authorization — nothing is granted until a camera is
pointed at that window.

- The secret is created on the Mac, returned **only over the local socket**, valid
  for **two minutes**, and redeemable **once**. It never touches the gossip channel.
- Redeeming authorizes the device whose key signed the request, and the request must
  be signed — a stolen secret alone is not enough.
- `polaris-relay devices` lists who can control the relay; **Revoke** in the Mac app
  (or `polaris-relay revoke <pubkey>`) takes it back.

Manual equivalent, if the camera path is unavailable:

```bash
polaris-relay authorize <pubkey> --label "Andrew's iPhone"
```

## Command line

```bash
node relay/src/cli.mjs status            # human-readable
node relay/src/cli.mjs status --json     # machine-readable
node relay/src/cli.mjs pin <regionId> <driveKey> [--version <v>]
node relay/src/cli.mjs unpin <regionId>
node relay/src/cli.mjs pause | resume
node relay/src/cli.mjs budget --pack-store-gb 25 --egress-gb 500 --seed-on-battery true
```

## Seeding a region that has no manifest yet (relay as publisher)

The published catalog lists 355 packs and signs a manifest for none of them, so
"Pin this region" is greyed out for almost everything. The relay can fix that for
itself: **Publish & seed** in the map catalog (or
`polaris-relay publish-region <regionId>`) will

1. download the region's assets from the catalog and verify each against its
   published md5 — unverified bytes are never authored into a pack,
2. author the **canonical writable drive** from those bytes, which fixes the key
   every later seeder will replicate,
3. sign a manifest binding `regionId → driveKey` with the relay's identity,
4. publish it to the same manifest gossip devices already read, remember it in
   `state/manifests.json`, and pin the result.

What this trusts and what it does not:

- **Content is still checked.** Canonical drives are writer-signed, every asset was
  md5-verified before authoring, and clients verify checksums on download. A relay
  can be stale or offline; it cannot serve different bytes under the same key.
- **The key is trusted because you paired with that Mac.** A relay signs with its
  own identity, which cannot be in the app's compiled-in allowlist. The phone
  therefore accepts manifests from relays it has paired with (the QR code). Pairing
  is the consent; revoking the pairing stops it.
- **Re-publishing is refused** once a verified manifest exists for a region, so two
  publishers cannot advertise two discovery keys for the same content.

`polaris-relay regions --refresh` lists what is ready, where each key came from
(`bundled`, `gossip` or a relay's own publication), and why the rest are not.

## Which regions are pinned

Nothing is seeded until a region is pinned, and the pin carries the canonical pack
key from the signed region manifest — the relay never invents or authors a pack.

The intended default is **the region you are currently in**: the app pins its
current region to the relay as you move, so the packs you can actually reach are
the ones being seeded. Pins can also be added by hand with `pin` above.

## Budgets

| Budget           | Default   | Behaviour at the limit                                                                |
| ---------------- | --------- | ------------------------------------------------------------------------------------- |
| Pack store       | 25 GiB    | Refuses new pins that would not fit; evicts the least-requested unpinned region first |
| Monthly egress   | 500 GB    | Stops serving for the rest of the month                                               |
| Burst rate       | 10 Mbit/s | Rate limited                                                                          |
| Peer connections | 32        | Further connections refused                                                           |
| Per-peer rate    | 2 Mbit/s  | Protects the aggregate from one client                                                |

Pinned regions are never evicted. When only pins remain and a new region does not
fit, the pin is reported as unmeetable rather than silently satisfied.

Edit `~/Library/Application Support/Polaris Relay/config.json` or use
`budget`. Values are clamped to sane ranges; an unparseable config falls back to
defaults and says so in `status`.

## When it pauses

| Condition                      | Default                                              |
| ------------------------------ | ---------------------------------------------------- |
| On battery                     | paused (enable with `budget --seed-on-battery true`) |
| Low Power Mode                 | paused                                               |
| Metered / expensive connection | paused (opt-in available)                            |
| Monthly egress cap reached     | paused until the next month                          |
| `pause` command                | paused until `resume`                                |
| Mac asleep                     | not running                                          |

Every pause reports a reason in `status` and in the menu bar.

## Files

| Path                                                      | What                                             |
| --------------------------------------------------------- | ------------------------------------------------ |
| `~/Library/Application Support/Polaris Relay/config.json` | budgets and preferences                          |
| `…/corestore/<regionId>/`                                 | the replicated blocks peers fetch                |
| `…/state/seeds.json`                                      | pinned regions and their canonical keys          |
| `…/state/usage.json`                                      | egress counter and demand timestamps             |
| `…/identity.json`                                         | the relay's announcement signing key (mode 0600) |
| `…/control.sock`                                          | local control socket (mode 0600)                 |
| `~/Library/Logs/Polaris Relay/relay.log`                  | daemon log                                       |

## Uninstalling

`relay/launchd/uninstall.sh` stops seeding and unloads the agent, keeping the seed
store so a re-install does not have to re-replicate everything. `--purge` deletes
it.

## Why it is not in the Mac App Store

A sandboxed App Store app may not register background agents or accept inbound
peer connections. The relay therefore ships as a separate, notarized download
outside the store — see `docs/decisions/0001-desktop-relay-primary-seeder.md`.
