#!/bin/bash
# Entry point for the launchd agent com.polaris.hostdeploy.
#
# launchd hands us a minimal environment (no Homebrew, no nvm), so this shim
# does nothing but locate a Python 3 and exec the real runner, which builds its
# own PATH. Keep this file boring: it is the one thing launchd executes.
set -uo pipefail

SUPPORT="${POLARIS_HOST_DEPLOY_SUPPORT:-$HOME/Library/Application Support/polaris-host-deploy}"
RUNNER="$SUPPORT/bin/polaris_host_deploy.py"

mkdir -p "$SUPPORT/logs"

PY=""
if [[ -s "$SUPPORT/bin/.python" ]]; then
  PY="$(cat "$SUPPORT/bin/.python")"
fi
if [[ -z "$PY" || ! -x "$PY" ]]; then
  for candidate in /usr/local/bin/python3 /opt/homebrew/bin/python3 /usr/bin/python3; do
    if [[ -x "$candidate" ]]; then PY="$candidate"; break; fi
  done
fi

if [[ -z "$PY" ]]; then
  echo "polaris-host-deploy: no python3 found; re-run scripts/host-deploy/install.sh" >&2
  exit 127
fi

if [[ ! -f "$RUNNER" ]]; then
  echo "polaris-host-deploy: runner missing at $RUNNER; re-run scripts/host-deploy/install.sh" >&2
  exit 127
fi

exec "$PY" "$RUNNER" --support "$SUPPORT" "$@"
