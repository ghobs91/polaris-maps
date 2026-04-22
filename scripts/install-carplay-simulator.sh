#!/bin/sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
IOS_DIR="$ROOT_DIR/ios"
APP_GLOB="$HOME/Library/Developer/Xcode/DerivedData"/*/Build/Products/Debug-iphonesimulator/PolarisMaps.app
ENTITLEMENTS_PATH="$IOS_DIR/PolarisMaps/PolarisMaps.SimulatorCarPlay.entitlements"

cd "$IOS_DIR"
xcodebuild -workspace PolarisMaps.xcworkspace -scheme PolarisMaps -configuration Debug -sdk iphonesimulator build

APP_PATH="$(ls -td $APP_GLOB 2>/dev/null | head -n 1)"
if [ -z "$APP_PATH" ]; then
  echo "Failed to locate built PolarisMaps.app" >&2
  exit 1
fi

codesign --force --sign - --entitlements "$ENTITLEMENTS_PATH" --timestamp=none "$APP_PATH"
xcrun simctl terminate booted com.polarismaps.app >/dev/null 2>&1 || true
xcrun simctl install booted "$APP_PATH"

echo "Installed simulator build with CarPlay entitlements: $APP_PATH"
codesign -d --entitlements :- "$APP_PATH" 2>&1