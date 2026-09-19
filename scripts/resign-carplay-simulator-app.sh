#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 /path/to/PolarisMaps.app" >&2
  exit 1
fi

APP_PATH="$1"
CARPLAY_NAVIGATION_KEY="com.apple.developer.carplay-navigation"
CARPLAY_MAPS_KEY="com.apple.developer.carplay-maps"
APP_IDENTIFIER_KEY="application-identifier"
MERGED_ENTITLEMENTS_PATH="$(mktemp "${TMPDIR:-/tmp}/polaris-carplay-entitlements.XXXXXX.plist")"

cleanup() {
  rm -f "$MERGED_ENTITLEMENTS_PATH"
}

trap cleanup EXIT INT TERM

if [ ! -d "$APP_PATH" ]; then
  echo "Simulator app not found at $APP_PATH" >&2
  exit 1
fi

# Start from a clean entitlements dict. Ad-hoc simulator signing only wants the
# entitlements the app itself needs; carrying over profile/distribution or
# restricted entitlements (CarPlay, iCloud, get-task-allow, team-id) makes the
# simulator refuse to exec the binary. The deletes below are kept as a guard.
cat > "$MERGED_ENTITLEMENTS_PATH" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList/1.0.dtd">
<plist version="1.0">
<dict/>
</plist>
PLIST

# Remove application-identifier (triggers SBMainWorkspace denial on simulators).
if /usr/libexec/PlistBuddy -c "Print :$APP_IDENTIFIER_KEY" "$MERGED_ENTITLEMENTS_PATH" >/dev/null 2>&1; then
  /usr/libexec/PlistBuddy -c "Delete :$APP_IDENTIFIER_KEY" "$MERGED_ENTITLEMENTS_PATH"
fi

# Remove any CarPlay entitlements.  CarPlay entitlements trigger SBMainWorkspace
# on simulators without a provisioning profile.  CarPlay Simulator testing
# requires an Apple-approved provisioning profile with com.apple.developer.carplay-navigation.
if /usr/libexec/PlistBuddy -c "Print :$CARPLAY_NAVIGATION_KEY" "$MERGED_ENTITLEMENTS_PATH" >/dev/null 2>&1; then
  /usr/libexec/PlistBuddy -c "Delete :$CARPLAY_NAVIGATION_KEY" "$MERGED_ENTITLEMENTS_PATH"
fi

if /usr/libexec/PlistBuddy -c "Print :$CARPLAY_MAPS_KEY" "$MERGED_ENTITLEMENTS_PATH" >/dev/null 2>&1; then
  /usr/libexec/PlistBuddy -c "Delete :$CARPLAY_MAPS_KEY" "$MERGED_ENTITLEMENTS_PATH"
fi

# Remove profile/distribution-only entitlements that block simulator launch when
# the app was previously signed with a real identity (`pnpm carplay:sim` tries
# profile signing first). A clean ad-hoc signature is what the simulator wants.
for key in \
  get-task-allow \
  beta-reports-active \
  com.apple.developer.team-identifier \
  keychain-access-groups \
  com.apple.developer.ubiquity-kvstore-identifier; do
  if /usr/libexec/PlistBuddy -c "Print :$key" "$MERGED_ENTITLEMENTS_PATH" >/dev/null 2>&1; then
    /usr/libexec/PlistBuddy -c "Delete :$key" "$MERGED_ENTITLEMENTS_PATH"
  fi
done

# Drop any profile embedded by the CarPlay profile-signing path; a leftover
# profile would keep authorizing the CarPlay entitlement on the simulator.
rm -f "$APP_PATH/embedded.mobileprovision"

codesign --force --sign - --entitlements "$MERGED_ENTITLEMENTS_PATH" --timestamp=none "$APP_PATH"

ENTITLEMENTS_OUTPUT="$(codesign -d --entitlements :- "$APP_PATH" 2>&1)"
echo "$ENTITLEMENTS_OUTPUT"

if printf '%s' "$ENTITLEMENTS_OUTPUT" | grep -q '<key>application-identifier</key>'; then
  echo "Re-signed simulator app still has application-identifier" >&2
  exit 1
fi

if printf '%s' "$ENTITLEMENTS_OUTPUT" | grep -q "$CARPLAY_NAVIGATION_KEY"; then
  echo "Re-signed simulator app still has carplay-navigation entitlement" >&2
  exit 1
fi

if printf '%s' "$ENTITLEMENTS_OUTPUT" | grep -q "$CARPLAY_MAPS_KEY"; then
  echo "Re-signed simulator app still has carplay-maps entitlement" >&2
  exit 1
fi