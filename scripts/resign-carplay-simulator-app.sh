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

if ! codesign -d --entitlements :- "$APP_PATH" > "$MERGED_ENTITLEMENTS_PATH" 2>/dev/null; then
  cat > "$MERGED_ENTITLEMENTS_PATH" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList/1.0.dtd">
<plist version="1.0">
<dict/>
</plist>
PLIST
fi

if ! grep -q '<plist' "$MERGED_ENTITLEMENTS_PATH"; then
  cat > "$MERGED_ENTITLEMENTS_PATH" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict/>
</plist>
PLIST
fi

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