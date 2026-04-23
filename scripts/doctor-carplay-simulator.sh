#!/bin/sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
IOS_DIR="$ROOT_DIR/ios"
PRIMARY_APP_PATH="$IOS_DIR/build/carplay-simulator-derived-data/Build/Products/Debug-iphonesimulator/PolarisMaps.app"
BUNDLE_ID="com.polarismaps.app"
APP_IDENTIFIER_KEY="application-identifier"

find_latest_simulator_app() {
  {
    if [ -d "$PRIMARY_APP_PATH" ]; then
      printf '%s\n' "$PRIMARY_APP_PATH"
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
  codesign -d --entitlements :- "$1" 2>&1 | grep -q 'com.apple.developer.carplay-\(navigation\|maps\)'
}

has_carplay_navigation_entitlement() {
  codesign -d --entitlements :- "$1" 2>&1 | grep -q 'com.apple.developer.carplay-navigation'
}

has_application_identifier_entitlement() {
  codesign -d --entitlements :- "$1" 2>&1 | grep -q "<key>$APP_IDENTIFIER_KEY</key>"
}

has_carplay_scene() {
  plutil -convert xml1 -o - "$1/Info.plist" 2>/dev/null | grep -q 'CPTemplateApplicationSceneSessionRoleApplication'
}

print_status() {
  label="$1"
  app_path="$2"

  if [ -z "$app_path" ] || [ ! -d "$app_path" ]; then
    echo "$label: missing"
    return
  fi

  echo "$label: $app_path"
  if has_carplay_entitlement "$app_path"; then
    echo "  carplay entitlement: present"
  else
    echo "  carplay entitlement: missing"
  fi

  if has_carplay_navigation_entitlement "$app_path"; then
    echo "  WARNING: carplay-navigation present (triggers SBMainWorkspace on simulators)"
  fi

  if has_application_identifier_entitlement "$app_path"; then
    echo "  application-identifier: present (can block simulator launch)"
  else
    echo "  application-identifier: absent"
  fi

  if has_carplay_scene "$app_path"; then
    echo "  carplay scene: present"
  else
    echo "  carplay scene: missing"
  fi
}

DEVICE_ID="$(xcrun simctl list devices | awk -F '[()]' '/Booted/ && /iPhone/ { print $2; exit }')"
LATEST_APP_PATH="$(find_latest_simulator_app)"
INSTALLED_APP_PATH=""

if [ -n "$DEVICE_ID" ]; then
  INSTALLED_APP_PATH="$(xcrun simctl get_app_container "$DEVICE_ID" "$BUNDLE_ID" 2>/dev/null || true)"
fi

echo "CarPlay simulator diagnosis"
if [ -n "$DEVICE_ID" ]; then
  echo "booted device: $DEVICE_ID"
else
  echo "booted device: none"
fi

print_status "latest build" "$LATEST_APP_PATH"
print_status "installed app" "$INSTALLED_APP_PATH"

if [ -z "$DEVICE_ID" ]; then
  echo "diagnosis: no booted iPhone simulator; boot one before checking installed state"
  exit 1
fi

if [ -z "$INSTALLED_APP_PATH" ]; then
  echo "diagnosis: Polaris Maps is not installed on the booted simulator"
  echo "action: run pnpm carplay:sim"
  exit 1
fi

if ! has_carplay_scene "$INSTALLED_APP_PATH"; then
  echo "diagnosis: installed app is missing the CarPlay scene registration"
  exit 1
fi

if ! has_carplay_entitlement "$INSTALLED_APP_PATH"; then
  echo "diagnosis: installed app is missing CarPlay entitlement"
  echo "  CarPlay Simulator requires a provisioning profile with com.apple.developer.carplay-navigation"
  echo "  Without it, the CarPlay scene will not be activated on the simulator"
  echo "action: request CarPlay entitlement from Apple, then add it to PolarisMaps.entitlements"
  exit 1
fi

if has_carplay_navigation_entitlement "$INSTALLED_APP_PATH"; then
  echo "diagnosis: installed app has carplay-navigation entitlement without a provisioning profile"
  echo "  This will trigger SBMainWorkspace denial on the simulator"
  echo "action: re-sign without CarPlay entitlements (pnpm carplay:sim) or use a provisioning profile"
  exit 1
fi

if has_application_identifier_entitlement "$INSTALLED_APP_PATH"; then
  echo "diagnosis: installed app still has application-identifier, which can block simulator launch"
  echo "action: run pnpm carplay:resign or pnpm carplay:sim"
  exit 1
fi

echo "diagnosis: installed app is CarPlay-eligible"
echo "if Polaris Maps still does not appear, restart the CarPlay Simulator to refresh its cached app list"