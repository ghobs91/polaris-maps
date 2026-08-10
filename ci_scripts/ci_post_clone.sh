#!/bin/sh
set -e

# ── ci_post_clone.sh ──────────────────────────────────────────────────
# Xcode Cloud post-clone script for Polaris Maps (Expo / React Native).
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
# Remove any stale pod cache, then do a clean install.
echo ""
echo "→ Cleaning CocoaPods cache…"
cd ios
rm -rf Pods
bundle exec pod cache clean --all 2>/dev/null || true

echo ""
echo "→ Running pod install (this may take a few minutes)…"
bundle exec pod install

# After pod install, ensure Manifest.lock is an exact copy of Podfile.lock.
# The build phase "[CP] Check Pods Manifest.lock" diffs these two files.
echo ""
echo "→ Syncing Manifest.lock…"
cp Podfile.lock Pods/Manifest.lock

echo ""
echo "→ Verifying critical files…"
ls -la "Pods/Target Support Files/Pods-PolarisMaps/Pods-PolarisMaps.release.xcconfig"
ls -la Pods/Manifest.lock
diff Podfile.lock Pods/Manifest.lock && echo "  ✓ Manifest.lock matches Podfile.lock"

cd ..

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Dependencies ready for Xcode build."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
