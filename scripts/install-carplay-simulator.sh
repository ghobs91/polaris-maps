#!/bin/sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
IOS_DIR="$ROOT_DIR/ios"
DERIVED_DATA_PATH="$IOS_DIR/build/carplay-simulator-derived-data"
APP_PATH="$DERIVED_DATA_PATH/Build/Products/Debug-iphonesimulator/PolarisMaps.app"
RESIGN_SCRIPT="$ROOT_DIR/scripts/resign-carplay-simulator-app.sh"
BUNDLE_ID="com.polarismaps.app"
CARPLAY_ENTITLEMENT_KEY="com.apple.developer.carplay-navigation"
CARPLAY_MAPS_KEY="com.apple.developer.carplay-maps"
APP_IDENTIFIER_KEY="application-identifier"

find_latest_simulator_app() {
  {
    if [ -d "$APP_PATH" ]; then
      printf '%s\n' "$APP_PATH"
    fi
    find "$HOME/Library/Developer/Xcode/DerivedData" \
      -path '*/Build/Products/Debug-iphonesimulator/PolarisMaps.app' \
      -type d \
      -print 2>/dev/null
  } | while IFS= read -r candidate; do
    if [ -n "$candidate" ]; then
      printf '%s\t%s\n' "$(stat -f '%m' "$candidate")" "$candidate"
    fi
  done | sort -nr | head -n 1 | cut -f2-
}

has_carplay_entitlement() {
  codesign -d --entitlements :- "$1" 2>&1 | grep -q "com.apple.developer.carplay-\(navigation\|maps\)"
}

has_application_identifier_entitlement() {
  codesign -d --entitlements :- "$1" 2>&1 | grep -q "<key>$APP_IDENTIFIER_KEY</key>"
}

DEVICE_ID="$(xcrun simctl list devices | awk -F '[()]' '/Booted/ { print $2; exit }')"

if [ -z "$DEVICE_ID" ]; then
  DEVICE_ID="$(xcrun simctl list devices | awk -F '[()]' '/iPhone .*Shutdown/ && $0 !~ /unavailable/ { print $2; exit }')"
fi

if [ -z "$DEVICE_ID" ]; then
  echo "Failed to locate an iPhone simulator to boot" >&2
  exit 1
fi

xcrun simctl boot "$DEVICE_ID" >/dev/null 2>&1 || true
xcrun simctl bootstatus "$DEVICE_ID" -b

if [ "${CARPLAY_SKIP_BUILD:-0}" != "1" ]; then
  cd "$IOS_DIR"
  xcodebuild \
    -workspace PolarisMaps.xcworkspace \
    -scheme PolarisMaps \
    -configuration Debug \
    -sdk iphonesimulator \
    -derivedDataPath "$DERIVED_DATA_PATH" \
    ARCHS=arm64 \
    build
else
  APP_PATH="$(find_latest_simulator_app)"
fi

if [ ! -d "$APP_PATH" ]; then
  echo "Failed to locate built PolarisMaps.app" >&2
  exit 1
fi

needs_resign=0

if has_application_identifier_entitlement "$APP_PATH"; then
  echo "application-identifier entitlement present, normalizing simulator signature"
  needs_resign=1
fi

if has_carplay_entitlement "$APP_PATH"; then
  echo "CarPlay entitlement present, removing for simulator compatibility"
  needs_resign=1
fi

if [ "$needs_resign" -eq 1 ]; then
  "$RESIGN_SCRIPT" "$APP_PATH"
fi

xcrun simctl terminate "$DEVICE_ID" "$BUNDLE_ID" >/dev/null 2>&1 || true
xcrun simctl install "$DEVICE_ID" "$APP_PATH"

INSTALLED_APP_PATH="$(xcrun simctl get_app_container "$DEVICE_ID" "$BUNDLE_ID" 2>/dev/null || true)"
if [ -n "$INSTALLED_APP_PATH" ]; then
  codesign -d --entitlements :- "$INSTALLED_APP_PATH" 2>&1
fi

# Launch the app.
xcrun simctl launch "$DEVICE_ID" "$BUNDLE_ID" 2>&1 || true

echo "Installed simulator build: $APP_PATH on $DEVICE_ID"