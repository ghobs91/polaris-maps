#!/bin/sh

# ── ci_post_clone.sh ──────────────────────────────────────────────────
# Xcode Cloud post-clone script for Polaris Maps.
#
# Runs from ios/ci_scripts/ — we cd ../.. to get to repo root.
# ──────────────────────────────────────────────────────────────────────

echo "━━━ Xcode Cloud post-clone ━━━"
cd ../..
echo "→ Repo root: $(pwd)"

# ── 1. Install Node.js ────────────────────────────────────────────────
# Xcode Cloud runners don't have Node.js on PATH.
# Download a portable arm64 binary — most reliable approach.
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

# Write .xcode.env so build-phase scripts (Expo configure, Metro bundle)
# can find Node.js via $NODE_BINARY.
cat > ios/.xcode.env << XCODEENV
export NODE_BINARY="/tmp/node/bin/node"
XCODEENV
echo "→ Wrote ios/.xcode.env with NODE_BINARY"

# ── 2. pnpm ────────────────────────────────────────────────────────────
echo ""
echo "→ Installing pnpm…"
npm install -g pnpm
echo "→ pnpm $(pnpm --version)"

# ── 3. Node deps ───────────────────────────────────────────────────────
echo ""
echo "→ pnpm install"
pnpm install --frozen-lockfile

# ── 4. CocoaPods ───────────────────────────────────────────────────────
# Xcode Cloud has CocoaPods pre-installed.
echo ""
echo "→ pod install"
cd ios
pod install
cd ..

echo ""
echo "━━━ post-clone complete ━━━"
