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
curl -fsSL --retry 3 "$NODE_URL" -o /tmp/node.tar.gz
mkdir -p /tmp/node
tar -xzf /tmp/node.tar.gz -C /tmp/node --strip-components=1
export PATH="/tmp/node/bin:$PATH"
echo "→ Node $(node --version)"
echo "→ npm $(npm --version)"

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
echo ""
echo "→ pnpm install"
pnpm install --frozen-lockfile || pnpm install --no-frozen-lockfile

# ── 4. Sync Manifest.lock ──────────────────────────────────────────────
echo ""
echo "→ Syncing Manifest.lock"
mkdir -p ios/Pods
cp ios/Podfile.lock ios/Pods/Manifest.lock

# ── 5. CocoaPods (with retry for network flakes) ───────────────────────
echo ""
echo "→ pod install"
cd ios

# Retry up to 3 times — Maven Central / GitHub can be flaky on CI
for i in 1 2 3; do
  echo "  Attempt $i/3…"
  if pod install --repo-update; then
    echo "  ✓ pod install succeeded"
    break
  fi
  if [ $i -lt 3 ]; then
    echo "  ✗ pod install failed, retrying in 5s…"
    sleep 5
  else
    echo "  ✗ pod install failed after 3 attempts"
    exit 1
  fi
done

cd ..

echo ""
echo "━━━ post-clone complete ━━━"
