#!/bin/sh
set -e

# ── ci_post_clone.sh ──────────────────────────────────────────────────
# Xcode Cloud post-clone script for Polaris Maps (Expo / React Native).
#
# Xcode Cloud runs this after cloning the repo and BEFORE resolving
# SPM dependencies and building.
# ──────────────────────────────────────────────────────────────────────

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Xcode Cloud — post-clone"
echo "  PWD: $(pwd)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Node.js is pre-installed on Xcode Cloud runners.
echo ""
echo "→ Node.js $(node --version)"
echo "→ npm $(npm --version)"

# ── pnpm ──────────────────────────────────────────────────────────────
echo ""
echo "→ Ensuring pnpm is available…"
if ! command -v pnpm >/dev/null 2>&1; then
  echo "  Installing pnpm via npm…"
  npm install -g pnpm
fi
echo "→ pnpm $(pnpm --version)"

# ── Node dependencies ─────────────────────────────────────────────────
echo ""
echo "→ Installing Node dependencies (pnpm install)…"
pnpm install --frozen-lockfile

# ── Ruby gems ─────────────────────────────────────────────────────────
echo ""
echo "→ Installing Ruby gems (bundle install)…"
bundle install

# ── CocoaPods ─────────────────────────────────────────────────────────
# Must use bundle exec to match the Gemfile's CocoaPods version.
echo ""
echo "→ Installing CocoaPods (bundle exec pod install)…"
cd ios
bundle exec pod install
cd ..

echo ""
echo "→ Verifying critical files exist…"
ls -la ios/Pods/Target\ Support\ Files/Pods-PolarisMaps/Pods-PolarisMaps.release.xcconfig

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Dependencies ready for Xcode build."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
