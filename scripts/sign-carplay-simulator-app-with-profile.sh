#!/bin/sh
set -eu

# Sign the simulator app with a Development provisioning profile that grants
# com.apple.developer.carplay-maps, so the app is eligible to appear in the
# CarPlay Simulator. Exits non-zero (before touching the app) when no suitable
# profile/identity is available, so callers can fall back to ad-hoc signing.
#
# Overrides:
#   CARPLAY_PROVISIONING_PROFILE  explicit path to a .mobileprovision
#   CARPLAY_SIGNING_IDENTITY      explicit codesigning identity common name
#   CARPLAY_PROFILE_DIR           directory of profiles to scan
#
# Note: only Development profiles (get-task-allow = true) are usable on the
# simulator; distribution/App Store profiles are ignored.

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 /path/to/PolarisMaps.app" >&2
  exit 2
fi

APP_PATH="$1"
BUNDLE_ID="com.polarismaps.app"
CARPLAY_MAPS_KEY="com.apple.developer.carplay-maps"
APP_IDENTIFIER_KEY="application-identifier"
LEGACY_PROFILE_DIR="$HOME/Library/MobileDevice/Provisioning Profiles"
XCODE_PROFILE_DIR="$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"

if [ ! -d "$APP_PATH" ]; then
  echo "Simulator app not found at $APP_PATH" >&2
  exit 2
fi

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/polaris-carplay-sign.XXXXXX")"
cleanup() { rm -rf "$WORK_DIR"; }
trap cleanup EXIT INT TERM

SELECTED_PROFILE="$WORK_DIR/profile.plist"
SELECTED_ENTITLEMENTS="$WORK_DIR/entitlements.plist"

# Reads a profile and, on success, writes its Entitlements dict + the full
# decoded profile into the SELECTED_* paths.
profile_matches() {
  candidate="$1"
  decoded="$WORK_DIR/candidate.plist"
  security cms -D -i "$candidate" > "$decoded" 2>/dev/null || return 1

  entitlements="$WORK_DIR/candidate-entitlements.plist"
  plutil -extract Entitlements xml1 -o "$entitlements" "$decoded" 2>/dev/null || return 1

  # Simulator-runnable profiles are Development profiles (get-task-allow).
  [ "$(/usr/libexec/PlistBuddy -c 'Print :get-task-allow' "$entitlements" 2>/dev/null || echo false)" = "true" ] || return 1

  [ "$(/usr/libexec/PlistBuddy -c "Print :$CARPLAY_MAPS_KEY" "$entitlements" 2>/dev/null || echo '')" = "true" ] || return 1

  app_id="$(/usr/libexec/PlistBuddy -c "Print :$APP_IDENTIFIER_KEY" "$entitlements" 2>/dev/null || echo '')"
  case "$app_id" in
    *."$BUNDLE_ID") ;;
    *) return 1 ;;
  esac

  cp "$decoded" "$SELECTED_PROFILE"
  cp "$entitlements" "$SELECTED_ENTITLEMENTS"
  return 0
}

# Scans a directory for the first matching profile, setting $PROFILE on success.
scan_profile_dir() {
  dir="$1"
  [ -d "$dir" ] || return 1
  for candidate in "$dir"/*.mobileprovision; do
    [ -f "$candidate" ] || continue
    if profile_matches "$candidate"; then
      PROFILE="$candidate"
      return 0
    fi
  done
  return 1
}

PROFILE="${CARPLAY_PROVISIONING_PROFILE:-}"
if [ -n "$PROFILE" ]; then
  if [ ! -f "$PROFILE" ]; then
    echo "Configured CarPlay provisioning profile not found: $PROFILE" >&2
    exit 1
  fi
  if ! profile_matches "$PROFILE"; then
    echo "Configured profile is not a Development profile with $CARPLAY_MAPS_KEY for $BUNDLE_ID" >&2
    exit 1
  fi
else
  PROFILE=""
  if [ -n "${CARPLAY_PROFILE_DIR:-}" ]; then
    scan_profile_dir "$CARPLAY_PROFILE_DIR" || true
  else
    # Xcode keeps automatic-signing profiles in UserData; manual installs land
    # in the legacy MobileDevice directory. Scan both.
    scan_profile_dir "$LEGACY_PROFILE_DIR" ||
      scan_profile_dir "$XCODE_PROFILE_DIR" || true
  fi
fi

if [ -z "$PROFILE" ] || [ ! -f "$SELECTED_PROFILE" ]; then
  echo "No Development provisioning profile with $CARPLAY_MAPS_KEY for $BUNDLE_ID found." >&2
  exit 1
fi

TEAM_ID="$(/usr/libexec/PlistBuddy -c 'Print :TeamIdentifier:0' "$SELECTED_PROFILE" 2>/dev/null || echo '')"

IDENTITY="${CARPLAY_SIGNING_IDENTITY:-}"
if [ -z "$IDENTITY" ] && [ -n "$TEAM_ID" ]; then
  IDENTITY="$(security find-identity -v -p codesigning 2>/dev/null \
    | grep 'Apple Development' | grep "($TEAM_ID)" \
    | sed -n 's/.*"\(.*\)".*/\1/p' | head -n 1)"
fi
if [ -z "$IDENTITY" ]; then
  IDENTITY="$(security find-identity -v -p codesigning 2>/dev/null \
    | grep 'Apple Development' | sed -n 's/.*"\(.*\)".*/\1/p' | head -n 1)"
fi
if [ -z "$IDENTITY" ]; then
  echo "No 'Apple Development' codesigning identity found." >&2
  exit 1
fi

# Embed the profile the entitlements are authorized by, then sign nested
# binaries first (frameworks carry no entitlements) and the app last.
cp "$PROFILE" "$APP_PATH/embedded.mobileprovision"

if [ -d "$APP_PATH/Frameworks" ]; then
  find "$APP_PATH/Frameworks" -maxdepth 1 \( -name '*.framework' -o -name '*.dylib' \) -print |
    while IFS= read -r nested; do
      codesign --force --sign "$IDENTITY" "$nested" >/dev/null 2>&1 || true
    done
fi

if [ -d "$APP_PATH/PlugIns" ]; then
  find "$APP_PATH/PlugIns" -maxdepth 1 -name '*.appex' -print |
    while IFS= read -r appex; do
      codesign --force --sign "$IDENTITY" "$appex" >/dev/null 2>&1 || true
    done
fi

if ! codesign --force --sign "$IDENTITY" --entitlements "$SELECTED_ENTITLEMENTS" "$APP_PATH"; then
  echo "codesign failed with identity '$IDENTITY'" >&2
  exit 1
fi

echo "Signed simulator app with profile '$(basename "$PROFILE")' and identity '$IDENTITY'"
