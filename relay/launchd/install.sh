#!/bin/sh
# Install the Polaris Relay as a per-user launch agent.
#
# What this does:
#   1. Resolves the Node binary and the repo path, because launchd does not read
#      your shell profile.
#   2. Writes ~/Library/LaunchAgents/app.polarismaps.relay.plist with those
#      absolute paths baked in.
#   3. Bootstraps the agent so it starts now and at every login, and keeps
#      running when the Polaris Maps app is quit.
#   4. Builds the menu-bar app, installs it to ~/Applications, registers it as a
#      login item, and opens it — because a seeder with no visible presence is a
#      service the user cannot tell is running, let alone stop.
#
# Re-run this after moving the repo, changing Node, or editing the template: the
# installed plist is what executes.
#
# v1 limitation, stated rather than hidden: the agent runs the relay out of this
# checkout, so the checkout must stay put. Packaging a self-contained
# `.app`/`.pkg` with an embedded Node runtime and dependency bundle is tracked in
# openspec/changes/add-desktop-relay-seeder/tasks.md (§3.6).
set -eu

LABEL="app.polarismaps.relay"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
RELAY_HOME="${POLARIS_RELAY_HOME:-$HOME/Library/Application Support/Polaris Relay}"
LOG_DIR="$HOME/Library/Logs/Polaris Relay"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
TEMPLATE="$REPO/relay/launchd/app.polarismaps.relay.plist.template"
DOMAIN="gui/$(id -u)"
CONTROLLER_LABEL="app.polarismaps.relay.controller"
CONTROLLER_PLIST="$HOME/Library/LaunchAgents/$CONTROLLER_LABEL.plist"
CONTROLLER_DEST="$HOME/Applications/Polaris Relay.app"
CONTROLLER_SRC="$REPO/relay/controller/build/Polaris Relay.app"

NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then
  echo "error: node not found on PATH. Install Node 22+ before installing the relay." >&2
  exit 1
fi

if [ ! -f "$TEMPLATE" ]; then
  echo "error: template missing at $TEMPLATE" >&2
  exit 1
fi

if [ ! -f "$REPO/backend/seed-core.mjs" ]; then
  echo "error: $REPO does not look like the Polaris Maps repo (backend/seed-core.mjs missing)" >&2
  exit 1
fi

# hyperdrive/hyperswarm resolve out of backend/node_modules, which is a separate
# npm package (see AGENTS.md). Without it the daemon starts and can seed nothing.
if [ ! -d "$REPO/backend/node_modules/hyperdrive" ]; then
  echo "error: backend dependencies are not installed. Run: (cd backend && npm install)" >&2
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR" "$RELAY_HOME"
chmod 700 "$RELAY_HOME"

echo "node       $NODE"
echo "repo       $REPO"
echo "relay home $RELAY_HOME"
echo "logs       $LOG_DIR"

# Substitute placeholders. `|` as the sed delimiter so paths with `/` are fine.
sed \
  -e "s|__NODE__|$NODE|g" \
  -e "s|__REPO__|$REPO|g" \
  -e "s|__RELAY_HOME__|$RELAY_HOME|g" \
  -e "s|__LOG_DIR__|$LOG_DIR|g" \
  "$TEMPLATE" > "$PLIST"
chmod 644 "$PLIST"

# Replace any previous instance. `bootout` fails harmlessly when nothing is
# loaded, but it is asynchronous: bootstrapping in the same breath can fail with
# `Bootstrap failed: 5: Input/output error` because the old job is still going
# away. Retry instead of reporting a scary error the user cannot act on.
# `enable` must come first: quitting the relay from the menu bar disables the label,
# and `bootstrap` on a disabled job fails with the same opaque error 5.
launchctl enable "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
bootstrapped=0
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if launchctl bootstrap "$DOMAIN" "$PLIST" 2>/dev/null; then
    bootstrapped=1
    break
  fi
  sleep 1
done
if [ "$bootstrapped" != "1" ]; then
  # Already loaded (bootstrap reports "already bootstrapped" as an error): a
  # kickstart is the right way to make it run.
  launchctl kickstart -k "$DOMAIN/$LABEL" 2>/dev/null || true
fi

echo
# A previously clean exit leaves the agent loaded but stopped (that is how an
# explicit stop survives a reboot). Installing is an explicit start, so force one.
launchctl kickstart -k "$DOMAIN/$LABEL" 2>/dev/null || true

# ── Menu-bar app ────────────────────────────────────────────────────
# Built here rather than shipped: it is a thin client of the control socket, and
# `swiftc` is all it needs. Without this step the relay runs invisibly and the
# only way to see or stop it is the command line.
if [ "${SKIP_CONTROLLER:-0}" != "1" ]; then
  if [ ! -d "$CONTROLLER_SRC" ]; then
    echo
    echo "Building the menu-bar app…"
    sh "$REPO/relay/controller/build.sh" >/dev/null
  fi

  mkdir -p "$HOME/Applications"
  rm -rf "$CONTROLLER_DEST"
  cp -R "$CONTROLLER_SRC" "$CONTROLLER_DEST"

  # Launched as a login item by launchd rather than through System Events, which
  # would need an Automation permission prompt to add it.
  cat > "$CONTROLLER_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$CONTROLLER_LABEL</string>
  <!-- The app binary directly, so launchd owns the process: it can report whether
       the icon is actually up, and restart it if it crashes. Launching via
       /usr/bin/open would leave the job "not running" one instant after login
       because `open` exits as soon as the app is launched. KeepAlive restarts a
       crash but not a Quit — Quit disables the job, so it stays down. -->
  <key>ProgramArguments</key>
  <array>
    <string>$CONTROLLER_DEST/Contents/MacOS/PolarisRelay</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>LimitLoadToSessionType</key>
  <string>Aqua</string>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/controller.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/controller.error.log</string>
</dict>
</plist>
PLIST
  chmod 644 "$CONTROLLER_PLIST"

  launchctl enable "$DOMAIN/$CONTROLLER_LABEL" 2>/dev/null || true
  launchctl bootout "$DOMAIN/$CONTROLLER_LABEL" 2>/dev/null || true
  pkill -f "PolarisRelay" 2>/dev/null || true
  sleep 1
  controller_loaded=0
  for attempt in 1 2 3 4 5; do
    if launchctl bootstrap "$DOMAIN" "$CONTROLLER_PLIST" 2>/dev/null; then
      controller_loaded=1
      break
    fi
    sleep 1
  done
  if [ "$controller_loaded" != "1" ]; then
    launchctl kickstart -k "$DOMAIN/$CONTROLLER_LABEL" 2>/dev/null || true
  fi
  sleep 2
  if launchctl print "$DOMAIN/$CONTROLLER_LABEL" >/dev/null 2>&1; then
    echo "Menu bar app installed at $CONTROLLER_DEST (look for the antenna icon)."
  else
    echo "Menu bar app installed at $CONTROLLER_DEST but not started. Open it once:"
    echo "  open \"$CONTROLLER_DEST\""
  fi
fi

echo
echo "Installed $LABEL."
echo "The relay now starts at login and restarts on crash, independently of the app."
echo "The menu-bar icon shows whether it is serving; quitting that app stops the relay."
echo
echo "Check it:   node \"$REPO/relay/src/cli.mjs\" status"
echo "Stop it:    click the menu bar icon → Quit Polaris Relay"
echo "            or: node \"$REPO/relay/src/cli.mjs\" stop"
echo "Uninstall:  $REPO/relay/launchd/uninstall.sh"
