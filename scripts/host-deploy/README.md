# Host deploy bridge (container → Mac)

Xcode cannot run inside the OpenHands Linux container, but the repository _can_
be written from both sides: `/projects` in the container is a bind mount of
`/Users/andrewg` on the Mac. This directory turns that shared folder into a job
queue so a container agent can ask the Mac to archive and upload a build.

```
 container (Linux)                          Mac (macOS)
 ─────────────────                          ───────────
 scripts/host-deploy/client.mjs
      │  write request.json
      ▼
 /projects/polaris-maps/.host-deploy/queue/<job_id>/
      │                                      launchd: com.polaris.hostdeploy
      │                                      (WatchPaths + StartInterval 120s)
      │                                            │
      │                                            ▼
      │                                   run-on-mac.sh → polaris_host_deploy.py
      │                                      validates the request against a
      │                                      fixed lane whitelist, then runs
      │                                      `bundle exec fastlane ios <lane>`
      │                                            │  creds + keychain stay here
      ▼                                            ▼
 .host-deploy/results/<job_id>/{status.json, log.txt, request.json}
      │
      └─ client streams the log and exits with the lane's status
```

No port is opened, no credential crosses the boundary, and the container never
gets a shell on the Mac.

## Install (once, on the Mac)

```bash
cd ~/projects/polaris-maps
./scripts/host-deploy/install.sh
```

It copies the runner to `~/Library/Application Support/polaris-host-deploy`,
snapshots `APP_STORE_CONNECT_KEY_ID` / `_ISSUER_ID` / `_KEY_PATH` into a mode-600
env file (launchd does not read your shell profile), creates
`.host-deploy/{queue,results}`, and loads `~/Library/LaunchAgents/com.polaris.hostdeploy.plist`.

Re-run it after editing anything in this directory, rotating the `.p8`, or
moving the repo. The **installed** copy is what executes — a change committed
from inside the container cannot alter what runs until you run the installer
again, which is the point.

Uninstall: `./scripts/host-deploy/uninstall.sh [--purge]`.

## Use (from the container or the Mac)

```bash
node scripts/host-deploy/client.mjs bridge       # is the executor alive?
node scripts/host-deploy/client.mjs preflight    # Xcode, creds, .env, git, scheme (no build)
node scripts/host-deploy/client.mjs submit --lane beta --note "carplay heading-up"
node scripts/host-deploy/client.mjs status <job_id>
node scripts/host-deploy/client.mjs logs <job_id> -n 120
node scripts/host-deploy/client.mjs list
node scripts/host-deploy/client.mjs cancel <job_id>
```

`submit` follows the job by default and exits with the lane's result:

| exit | meaning                                                                            |
| ---- | ---------------------------------------------------------------------------------- |
| 0    | lane succeeded (a `.ipa` exists; for `beta` it was accepted by App Store Connect)  |
| 1    | lane failed — `status.json.failure` carries `kind`, `message`, `hint`              |
| 2    | request rejected (unknown lane, bad schema)                                        |
| 3    | bridge unavailable, or a local gate refused (dirty tree, not on `main`, no `.env`) |

Lanes: `preflight` (built-in, host-only checks), `beta`, `release`, `validate`.
The commands are fixed in `LANE_COMMANDS` inside `polaris_host_deploy.py`; a
request can only name a lane, never a command.

## What the request may say

```json
{
  "schema": 1,
  "lane": "beta",
  "note": "carplay heading-up",
  "requested_by": "openhands",
  "allow_dirty": false,
  "allow_non_main": false,
  "skip_match": false
}
```

Anything else is rejected, as is any lane outside the whitelist, any symlinked
`request.json`, any file over 8 KiB, and any job directory not owned by the
logged-in user. `allow_dirty` / `allow_non_main` map to `POLARIS_ALLOW_DIRTY` /
`POLARIS_ALLOW_NON_MAIN`, and `skip_match` to `SKIP_MATCH`, exactly as the
`beta` lane documents — use them deliberately, they bypass the lane's own
release-source guard.

## Notes from a real install on this machine

- **Ruby.** `/usr/bin/bundle` is Ruby 2.6 and cannot read this repo's
  `Gemfile.lock` (`BUNDLED WITH 4.0.10`). The runner puts
  `/opt/homebrew/opt/ruby/bin` first on `PATH`, so `bundle exec fastlane` uses
  Homebrew Ruby 4.x even though an interactive shell resolves the system one.
- **Xcode.** `DEVELOPER_DIR` is forced to `/Applications/Xcode.app/Contents/Developer`.
  A beta Xcode archives fine and then gets rejected at upload with code 90534.
- **Sleep.** Each job runs under `caffeinate -i -m`; the Mac will not idle-sleep
  mid-archive. Closing the lid still stops it.
- **Keychain.** The agent runs in the GUI session (`launchctl bootstrap gui/$UID`),
  so it uses the unlocked login keychain. If `codesign` reports no identity while
  `security find-identity` shows one, unlock the login keychain and re-run; the
  first codesign from a launchd agent may raise a one-time access prompt.
- **Restart safety.** A single job at a time, behind an `flock`. A job already
  running survives the arrival of more requests; they queue. `RunAtLoad` and a
  120 s `StartInterval` drain anything left over after a reboot or a missed
  WatchPaths event.

## Adding a lane

1. Add an entry to `LANE_COMMANDS` in `polaris_host_deploy.py` (command + timeout).
2. Re-run `./scripts/host-deploy/install.sh`.
3. Add the lane to `LANES` in `client.mjs` so the client lists and validates it.

Never make a lane take a command or arbitrary arguments from the request.
