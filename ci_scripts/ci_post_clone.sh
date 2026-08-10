#!/bin/sh

# ── ci_post_clone.sh ──────────────────────────────────────────────────
# Xcode Cloud post-clone script for Polaris Maps.
# ──────────────────────────────────────────────────────────────────────

echo "━━━ Xcode Cloud post-clone ━━━"
cd ../..
echo "→ Repo root: $(pwd)"

# ── 1. Install Node.js ────────────────────────────────────────────────
echo ""
echo "→ Installing Node.js…"
NODE_VERSION="22.11.0"
NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-darwin-arm64.tar.gz"
curl -fsSL "$NODE_URL" -o /tmp/node.tar.gz
mkdir -p /tmp/node
tar -xzf /tmp/node.tar.gz -C /tmp/node --strip-components=1
export PATH="/tmp/node/bin:$PATH"
echo "→ Node $(node --version)"
echo "→ npm $(npm --version)"

# Write .xcode.env so build-phase scripts find Node.js
cat > ios/.xcode.env << XCODEENV
export NODE_BINARY="/tmp/node/bin/node"
XCODEENV
echo "→ Wrote ios/.xcode.env"

# ── 2. pnpm ────────────────────────────────────────────────────────────
echo ""
echo "→ Installing pnpm…"
npm install -g pnpm
echo "→ pnpm $(pnpm --version)"

# ── 3. Node deps ───────────────────────────────────────────────────────
# Frozen lockfile may fail due to version/config drift on CI.
# Fall back to a regular install which updates the lockfile.
echo ""
echo "→ pnpm install"
pnpm install --frozen-lockfile || pnpm install --no-frozen-lockfile

# ── 4. Sync Manifest.lock ──────────────────────────────────────────────
# The build phase [CP] Check Pods Manifest.lock copies Podfile.lock
# to Manifest.lock, but PODS_PODFILE_DIR_PATH may be empty on Xcode Cloud.
# Pre-create it so the phase doesn't fail.
echo ""
echo "→ Syncing Manifest.lock"
mkdir -p ios/Pods
cp ios/Podfile.lock ios/Pods/Manifest.lock

# ── 5. CocoaPods ───────────────────────────────────────────────────────
echo ""
echo "→ pod install"
cd ios
pod install
cd ..

echo ""
echo "━━━ post-clone complete ━━━"
