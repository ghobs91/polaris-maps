#!/bin/sh
# Remove the Polaris Relay launch agent.
#
#   ./uninstall.sh           stop seeding and unload the agent, keep the seed store
#   ./uninstall.sh --purge   also delete the seed store, config, logs and menu-bar app
#
# Stopping is deliberately non-destructive by default: a 25 GiB pack store is
# expensive to rebuild, and re-installing should not mean re-replicating every
# region from scratch.
set -eu

LABEL="app.polarismaps.relay"
CONTROLLER_LABEL="app.polarismaps.relay.controller"
CONTROLLER_PLIST="$HOME/Library/LaunchAgents/$CONTROLLER_LABEL.plist"
CONTROLLER_APP="$HOME/Applications/Polaris Relay.app"
DOMAIN="gui/$(id -u)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
RELAY_HOME="${POLARIS_RELAY_HOME:-$HOME/Library/Application Support/Polaris Relay}"
LOG_DIR="$HOME/Library/Logs/Polaris Relay"

launchctl bootout "$DOMAIN/$CONTROLLER_LABEL" 2>/dev/null || true
launchctl disable "$DOMAIN/$CONTROLLER_LABEL" 2>/dev/null || true
rm -f "$CONTROLLER_PLIST"
pkill -f "PolarisRelay" 2>/dev/null || true

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl disable "$DOMAIN/$LABEL" 2>/dev/null || true
rm -f "$PLIST"
echo "Removed $LABEL."

if [ "${1:-}" = "--purge" ]; then
  rm -rf "$RELAY_HOME" "$LOG_DIR" "$CONTROLLER_APP"
  echo "Purged $RELAY_HOME and $LOG_DIR"
else
  echo "Kept the seed store at $RELAY_HOME (use --purge to delete it)"
fi
