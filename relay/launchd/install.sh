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

# Replace any previous instance. `bootout` fails harmlessly when nothing is loaded.
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$PLIST"
launchctl enable "$DOMAIN/$LABEL" 2>/dev/null || true

echo
echo "Installed $LABEL."
echo "The relay now starts at login and restarts on crash, independently of the app."
echo
echo "Check it:   node \"$REPO/relay/src/cli.mjs\" status"
echo "Stop it:    launchctl bootout $DOMAIN/$LABEL && launchctl disable $DOMAIN/$LABEL"
echo "Uninstall:  $REPO/relay/launchd/uninstall.sh"
