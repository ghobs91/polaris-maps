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

# ── 5. CocoaPods (with retry for network flakes) ───────────────────────
echo ""
echo "→ pod install"
cd ios

# ── 5. CocoaPods (with retry for network flakes) ───────────────────────
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

# ── 6. Write .env from Xcode Cloud environment variables ────────────────
# Xcode Cloud secrets/variables are exposed as environment variables.
# Expo's Metro bundler reads .env files to inline EXPO_PUBLIC_* values
# into the production JS bundle. The .env file is gitignored and lives
# only in the Xcode Cloud working directory.
echo ""
echo "→ Writing .env from Xcode Cloud environment"
env | grep '^EXPO_PUBLIC_' > .env
if [ -s .env ]; then
  echo "→ Wrote $(wc -l < .env | tr -d ' ') EXPO_PUBLIC_* entries to .env"
else
  echo "⚠️ No EXPO_PUBLIC_* variables found in Xcode Cloud environment"
fi

echo ""
echo "━━━ post-clone complete ━━━"
