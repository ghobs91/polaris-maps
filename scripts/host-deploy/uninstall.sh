#!/bin/bash
# uninstall.sh — unload and remove the host deploy agent.
#
#   ./scripts/host-deploy/uninstall.sh          # unload agent, remove the plist
#   ./scripts/host-deploy/uninstall.sh --purge  # also delete the support dir and job state
#
# The repo's scripts/host-deploy/ files are left alone; they are the source of
# truth you would re-install from.
set -euo pipefail

LABEL="com.polaris.hostdeploy"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
SUPPORT="${POLARIS_HOST_DEPLOY_SUPPORT:-$HOME/Library/Application Support/polaris-host-deploy}"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
PURGE=0

[[ "${1:-}" == "--purge" ]] && PURGE=1

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl unload "$PLIST" 2>/dev/null || true
rm -f "$PLIST"
echo "removed $PLIST"

if [[ $PURGE -eq 1 ]]; then
  rm -rf "$SUPPORT"
  rm -rf "$REPO_ROOT/.host-deploy"
  echo "removed $SUPPORT and $REPO_ROOT/.host-deploy"
fi
