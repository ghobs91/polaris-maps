#!/bin/sh
set -e

# ── ci_post_clone.sh ──────────────────────────────────────────────────
# Xcode Cloud post-clone script for Polaris Maps (Expo / React Native).
#
# Xcode Cloud runs this after cloning the repo and before building.
# Install all dependencies so the "Bundle React Native code and images"
# build phase can find Node.js, pnpm, and the bundled Metro server.
# ──────────────────────────────────────────────────────────────────────

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Xcode Cloud — post-clone"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Node.js is pre-installed on Xcode Cloud runners. Verify it's available.
echo "→ Node.js $(node --version)"
echo "→ npm $(npm --version)"

# ── pnpm ──────────────────────────────────────────────────────────────
# Xcode Cloud may not have pnpm. Install it globally if missing.
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
bundle install --quiet

# ── CocoaPods ─────────────────────────────────────────────────────────
echo ""
echo "→ Installing CocoaPods (pod install)…"
cd ios
pod install
cd ..

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Dependencies ready for Xcode build."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
