#!/bin/bash
# install.sh — put the Polaris host deploy executor on this Mac.
#
#   ./scripts/host-deploy/install.sh              # install + load the launchd agent
#   ./scripts/host-deploy/install.sh --no-load    # install files only (for inspection)
#   ./scripts/host-deploy/install.sh --repo /path/to/polaris-maps
#
# What it does
#   1. copies the runner into ~/Library/Application Support/polaris-host-deploy
#      (the *installed* copy is what runs, so editing the repo cannot silently
#      change what executes on the host — re-run this script to publish changes)
#   2. snapshots the App Store Connect variables into a 600 env file there
#      (launchd does not read your shell profile)
#   3. installs and loads ~/Library/LaunchAgents/com.polaris.hostdeploy.plist
#
# Re-run it whenever you change scripts/host-deploy/*, rotate the .p8, or move
# the repo. It is idempotent.
set -euo pipefail

LABEL="com.polaris.hostdeploy"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
SUPPORT="${POLARIS_HOST_DEPLOY_SUPPORT:-$HOME/Library/Application Support/polaris-host-deploy}"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOAD=1
CREDS=(APP_STORE_CONNECT_KEY_ID APP_STORE_CONNECT_ISSUER_ID APP_STORE_CONNECT_KEY_PATH)

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-load) LOAD=0; shift ;;
    --repo) REPO_ROOT="$(cd "${2:?--repo needs a path}" && pwd)"; shift 2 ;;
    --support) SUPPORT="${2:?--support needs a path}"; shift 2 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

step() { printf '\n[%s] %s\n' "$1" "$2"; }
fail() { printf 'error: %s\n' "$1" >&2; exit 1; }

[[ "$(uname -s)" == "Darwin" ]] || fail "this installer runs on the Mac (got $(uname -s)). Run it from the host, not the container."
[[ -d "$REPO_ROOT/ios/PolarisMaps.xcworkspace" ]] || fail "no ios/PolarisMaps.xcworkspace under $REPO_ROOT — pass --repo"
[[ -f "$HERE/polaris_host_deploy.py" ]] || fail "runner source missing at $HERE/polaris_host_deploy.py"

step 1/6 "Locating a Python 3 for launchd"
PY=""
for candidate in /usr/local/bin/python3 /opt/homebrew/bin/python3 /usr/bin/python3; do
  if [[ -x "$candidate" ]] && "$candidate" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 9) else 1)' 2>/dev/null; then
    PY="$candidate"; break
  fi
done
[[ -n "$PY" ]] || fail "no python3 >= 3.9 found (tried /usr/local/bin, /opt/homebrew/bin, /usr/bin)"
echo "    $PY ($("$PY" -V 2>&1))"

step 2/6 "Installing runner into $SUPPORT"
mkdir -p "$SUPPORT/bin" "$SUPPORT/logs" "$SUPPORT/env.d"
cp "$HERE/polaris_host_deploy.py" "$SUPPORT/bin/polaris_host_deploy.py"
cp "$HERE/run-on-mac.sh" "$SUPPORT/bin/run-on-mac.sh"
printf '%s\n' "$PY" > "$SUPPORT/bin/.python"
chmod 755 "$SUPPORT/bin/polaris_host_deploy.py" "$SUPPORT/bin/run-on-mac.sh"
chmod 644 "$SUPPORT/bin/.python"
"$PY" - "$SUPPORT" "$REPO_ROOT" <<'PY'
import json, sys, datetime
support, repo = sys.argv[1], sys.argv[2]
cfg = {
    "schema": 1,
    "repo_root": repo,
    "support": support,
    "label": "com.polaris.hostdeploy",
    "installed_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "lanes": {"preflight": "builtin", "beta": "bundle exec fastlane ios beta",
              "release": "bundle exec fastlane ios release",
              "validate": "bundle exec fastlane ios validate"},
}
json.dump(cfg, open(f"{support}/config.json", "w"), indent=2)
PY
echo "    config  $SUPPORT/config.json"
echo "    repo    $REPO_ROOT"

step 3/6 "Snapshotting App Store Connect credentials"
ENV_FILE="$SUPPORT/env"
umask 077
: > "$ENV_FILE"
for name in "${CREDS[@]}"; do
  value="${!name:-}"
  if [[ -z "$value" ]]; then
    value="$(zsh -lc "printf '%s' \"\${$name}\"" 2>/dev/null || true)"
  fi
  if [[ -z "$value" ]]; then
    echo "    MISSING $name" >&2
  else
    printf '%s=%s\n' "$name" "$value" >> "$ENV_FILE"
  fi
done
# PATH additions the runner needs on top of its own defaults (optional).
printf 'POLARIS_INSTALLED_AT=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$ENV_FILE"
chmod 600 "$ENV_FILE"
echo "    $ENV_FILE (mode 600, $(wc -l < "$ENV_FILE" | tr -d ' ') lines)"

KEY_PATH="$(sed -n 's/^APP_STORE_CONNECT_KEY_PATH=//p' "$ENV_FILE")"
if [[ -n "$KEY_PATH" ]]; then
  case "$KEY_PATH" in
    *"/Downloads/"*|*"/Desktop/"*|*"/Documents/"*)
      echo "    WARNING: $KEY_PATH is under a TCC-protected folder; altool and xcodebuild will fail" >&2
      echo "             with 'Operation not permitted'. Move it to ~/.appstoreconnect/private_keys/." >&2
      ;;
  esac
  [[ -r "$KEY_PATH" ]] || echo "    WARNING: key not readable: $KEY_PATH" >&2
fi

step 4/6 "Creating the job queue"
mkdir -p "$REPO_ROOT/.host-deploy/queue" "$REPO_ROOT/.host-deploy/results"
chmod 777 "$REPO_ROOT/.host-deploy/queue"
echo "    $REPO_ROOT/.host-deploy/queue"

step 5/6 "Rendering the launchd agent"
mkdir -p "$HOME/Library/LaunchAgents"
sed -e "s|__SUPPORT__|$SUPPORT|g" \
    -e "s|__REPO__|$REPO_ROOT|g" \
    -e "s|__HOME__|$HOME|g" \
    "$HERE/com.polaris.hostdeploy.plist.template" > "$PLIST"
plutil -lint "$PLIST" >/dev/null || fail "rendered plist is invalid: $PLIST"
echo "    $PLIST"

step 6/6 "Loading the agent"
if [[ $LOAD -eq 1 ]]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  if ! launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null; then
    launchctl unload "$PLIST" 2>/dev/null || true
    launchctl load -w "$PLIST" || fail "could not load $PLIST"
  fi
  sleep 1
  if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
    echo "    $LABEL is loaded (gui/$(id -u))"
  else
    echo "    WARNING: $LABEL did not report as loaded; check: launchctl print gui/$(id -u)/$LABEL" >&2
  fi
else
  echo "    skipped (--no-load)"
fi

cat <<EOF

Bridge ready.

  Mac runner    $SUPPORT/bin/run-on-mac.sh
  Daemon log    $SUPPORT/logs/daemon.log
  Job queue     $REPO_ROOT/.host-deploy/queue
  Results       $REPO_ROOT/.host-deploy/results

From the container (OpenHands):

  node scripts/host-deploy/client.mjs bridge      # is the executor alive?
  node scripts/host-deploy/client.mjs preflight   # Xcode, credentials, .env, git, scheme
  node scripts/host-deploy/client.mjs submit --lane beta --note "what changed"

${LABEL} watches the queue through launchd, so no port is opened and no
credential leaves this Mac. Re-run this script after editing scripts/host-deploy/.
EOF
