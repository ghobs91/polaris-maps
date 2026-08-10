#!/bin/sh

# ── ci_post_clone.sh ──────────────────────────────────────────────────
# Xcode Cloud post-clone script for Polaris Maps (Expo / React Native).
#
# Xcode Cloud runs this from the ios/ci_scripts/ directory.
# We need to cd back to the repo root first.
# ──────────────────────────────────────────────────────────────────────

echo "━━━ Xcode Cloud post-clone ━━━"
echo "→ PWD: $(pwd)"

# Navigate to repo root (ci_scripts runs from ios/ci_scripts/)
cd ../..

echo "→ PWD (repo root): $(pwd)"

# ── 1. Node.js ─────────────────────────────────────────────────────────
# Xcode Cloud has Node.js but it may not be on PATH.
# Source nvm if available, otherwise look in common locations.
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  echo "→ Loading nvm…"
  . "$HOME/.nvm/nvm.sh"
  nvm use 22 2>/dev/null || nvm use node 2>/dev/null || true
fi

# Try to find node
if ! command -v node >/dev/null 2>&1; then
  for candidate in /usr/local/bin/node /opt/homebrew/bin/node; do
    if [ -x "$candidate" ]; then
      export PATH="$(dirname "$candidate"):$PATH"
      break
    fi
  done
fi

if command -v node >/dev/null 2>&1; then
  echo "→ Node.js $(node --version)"
else
  echo "! WARNING: Node.js not found — React Native bundle step may fail"
fi

# ── 2. pnpm ────────────────────────────────────────────────────────────
if ! command -v pnpm >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
  echo "→ Installing pnpm…"
  npm install -g pnpm
fi
echo "→ pnpm $(pnpm --version 2>/dev/null || echo 'not found')"

# ── 3. Node deps ───────────────────────────────────────────────────────
echo "→ pnpm install"
pnpm install --frozen-lockfile 2>/dev/null || pnpm install

# ── 4. Ruby gems ───────────────────────────────────────────────────────
echo "→ bundle install"
bundle install 2>/dev/null || gem install bundler -v "$(grep -A1 'BUNDLED WITH' Gemfile.lock | tail -1 | xargs)" && bundle install

# ── 5. CocoaPods ───────────────────────────────────────────────────────
echo "→ pod install"
cd ios
bundle exec pod install --repo-update 2>/dev/null || bundle exec pod install
cd ..

echo "━━━ post-clone complete ━━━"
