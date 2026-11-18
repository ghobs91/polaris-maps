#!/bin/sh
# Build the menu-bar controller into a self-contained `.app`.
#
# No Xcode project: this is a status item with a menu, and building it with
# `swiftc` keeps it reviewable as code and verifiable on any Mac with the command
# line tools installed. Notarization for distribution is a separate step (see
# docs/relay.md); an ad-hoc signed local build is enough to run it on the machine
# that builds it.
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:-$HERE/build}"
APP="$OUT/Polaris Relay.app"
BINARY="$APP/Contents/MacOS/PolarisRelay"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>Polaris Relay</string>
  <key>CFBundleDisplayName</key>
  <string>Polaris Relay</string>
  <key>CFBundleIdentifier</key>
  <string>app.polarismaps.relay.controller</string>
  <key>CFBundleExecutable</key>
  <string>PolarisRelay</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <!-- Menu bar only: no Dock icon, no main window. -->
  <key>LSUIElement</key>
  <true/>
</dict>
</plist>
PLIST

# Multiple sources with a SwiftUI `@main` need `-parse-as-library`, and Swift 5
# language mode keeps the build free of Swift 6 strict-concurrency errors in code
# this small.
swiftc -O -parse-as-library -swift-version 5 \
  -o "$BINARY" \
  "$HERE/Sources/"*.swift \
  -framework AppKit -framework SwiftUI
chmod +x "$BINARY"

# Ad-hoc signature: proves the binary is intact. Real distribution needs a
# Developer ID identity and notarization (documented in docs/relay.md).
codesign --force --sign - "$APP" >/dev/null 2>&1 || true

echo "Built $APP"
echo "Run it:   open \"$APP\""
echo "Dashboard:   "$APP/Contents/MacOS/PolarisRelay" --selftest   # prove it can read the daemon"
echo "Quitting it stops the relay: seeding ends, the daemon exits and the launch agent is disabled."
