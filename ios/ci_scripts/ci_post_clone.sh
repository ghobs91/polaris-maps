#!/bin/sh

# ── ci_post_clone.sh ──────────────────────────────────────────────────
# Xcode Cloud post-clone script for Polaris Maps (Expo / React Native).
#
# Minimal — bail fast on any failure so the log is clear.
# ──────────────────────────────────────────────────────────────────────

echo "━━━ Xcode Cloud post-clone ━━━"

# 1. Node
echo "→ Node $(node --version)"

# 2. pnpm
if ! command -v pnpm >/dev/null 2>&1; then
  npm install -g pnpm
fi
echo "→ pnpm $(pnpm --version)"

# 3. Node deps
echo "→ pnpm install"
pnpm install --frozen-lockfile

# 4. Ruby gems
echo "→ bundle install"
bundle install

# 5. CocoaPods — clean install
echo "→ pod install"
cd ios
rm -rf Pods
bundle exec pod install --repo-update
cp Podfile.lock Pods/Manifest.lock
cd ..

echo "━━━ post-clone complete ━━━"
