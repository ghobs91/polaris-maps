# Quickstart: Polaris Maps Development

**Feature**: `001-p2p-depin-mapping`  
**Date**: 2026-03-05

---

## Prerequisites

| Tool              | Version   | Purpose                               |
| ----------------- | --------- | ------------------------------------- |
| Node.js           | 20 LTS    | Build toolchain + nodejs-mobile dev   |
| pnpm              | 9.x       | Package manager                       |
| Expo CLI          | Latest    | `npx expo` — no global install needed |
| Xcode             | 15+       | iOS builds (macOS only)               |
| Android Studio    | Hedgehog+ | Android builds                        |
| Android NDK       | r26+      | Valhalla C++ compilation for Android  |
| CMake             | 3.22+     | Valhalla native build                 |
| CocoaPods         | 1.15+     | iOS native dependencies               |
| Protobuf compiler | 3.x       | Waku message schema compilation       |

## 1. Clone and Install

```bash
git clone <repo-url> polaris-maps
cd polaris-maps
git checkout 001-p2p-depin-mapping

pnpm install
```

## 2. Initialize Expo Bare Project

```bash
npx expo prebuild --clean
```

This generates `ios/` and `android/` directories with native projects.

## 3. Configure Native Modules

### Valhalla (C++)

```bash
# iOS — Valhalla builds as a static library via CMake in the Xcode project
cd ios
pod install
cd ..

# Android — Valhalla builds via CMakeLists.txt integrated in android/app/build.gradle
# NDK path must be set in local.properties:
echo "ndk.dir=$ANDROID_NDK_HOME" >> android/local.properties
```

### nodejs-mobile (Waku sidecar)

```bash
# The nodejs-mobile project lives in nodejs-assets/nodejs-project/
# Install its dependencies separately:
cd nodejs-assets/nodejs-project
npm install
cd ../..
```

### react-native-bare-kit (Hypercore)

```bash
# bare-kit configures itself via Expo config plugin
# Verify it's in app.json:
#   "plugins": ["react-native-bare-kit"]
```

## 4. Prepare Test Data

For development, you need a small regional dataset. Use the LA metro area as the test region:

```bash
# Download test PMTiles (LA metro, ~50 MB)
mkdir -p test-data
curl -o test-data/overture-us-ca-la.pmtiles \
  "https://arweave.net/<PMTILES_TX_ID>"

# Download test Valhalla graph tiles (LA metro, ~150 MB compressed)
curl -o test-data/routing-us-ca-la.tar.gz \
  "https://arweave.net/<ROUTING_TX_ID>"
tar -xzf test-data/routing-us-ca-la.tar.gz -C test-data/routing/

# Download test geocoding database (LA metro, ~80 MB)
curl -o test-data/geocoding-us-ca-la.sqlite \
  "https://arweave.net/<GEOCODING_TX_ID>"
```

**Note**: Replace `<..._TX_ID>` with actual Arweave transaction IDs once data is uploaded. During initial development, generate test data locally using the data pipeline scripts (see below).

## 5. Run the App

### iOS Simulator

```bash
npx expo run:ios
```

### Android Emulator

```bash
npx expo run:android
```

### Physical Device (recommended for P2P testing)

```bash
# iOS
npx expo run:ios --device

# Android
npx expo run:android --device
```

## 6. Run Tests

```bash
# Unit tests
pnpm test

# Unit tests in watch mode
pnpm test --watch

# Integration tests (React Native Testing Library)
pnpm test:integration

# Contract tests (Waku, Gun.js, Hypercore protocol schemas)
pnpm test:contract

# E2E tests (Detox — requires running simulator/emulator)
pnpm test:e2e:ios
pnpm test:e2e:android

# Benchmark tests
pnpm test:benchmark
```

## 7. Linting and Formatting

```bash
# Lint
pnpm lint

# Format
pnpm format

# Type check
pnpm typecheck

# All checks (runs in CI)
pnpm check
```

## 8. Commit Conventions

Commits follow Conventional Commits format:

```
feat(map): add PMTiles tile server module
fix(routing): correct reroute bearing calculation
test(traffic): add Waku probe message contract test
refactor(poi): extract Gun.js storage adapter
docs(quickstart): add Android NDK setup instructions
```

Enforced by commitlint via Husky pre-commit hook.

## 9. Project Layout Reference

```
app/                     # Expo Router screens
src/
├── components/          # React components
├── services/            # Business logic
├── models/              # TypeScript types
├── stores/              # Zustand state
├── native/              # Native module bridges
├── hooks/               # Custom hooks
├── utils/               # Pure utilities
├── constants/           # Config & constants
└── types/               # Global type declarations
ios/                     # iOS native project
android/                 # Android native project
nodejs-assets/           # nodejs-mobile Waku sidecar
__tests__/               # All tests
test-data/               # Local development data
```

## 10. Development Tips

- **Two physical devices** are needed to test P2P features (traffic, POI sync, Gun.js replication). Use one iOS + one Android device for best coverage.
- **Gun.js relay**: For local dev, run a Gun relay on your machine: `npx gun --port 8765`. Point the app's relay list at `ws://YOUR_IP:8765/gun`.
- **Waku**: For local dev, run a nwaku node: `docker run -p 60000:60000 statusteam/nwaku`. This gives you a local Waku relay to test against.
- **MapLibre style editing**: The map style JSON is in `src/constants/mapStyle.ts`. Edit and hot-reload to iterate on map appearance.
- **Valhalla graph generation**: To generate routing graphs from Overture data locally, see the `scripts/data-pipeline/` directory (created during implementation).

## Validation Checklist

After setup, verify these work:

- [ ] App launches and shows a map (MapLibre + local PMTiles)
- [ ] Search returns address results (SQLite FTS5 geocoding)
- [ ] Route computation returns directions (Valhalla native module)
- [ ] `pnpm test` passes all unit tests
- [ ] `pnpm lint` reports no errors
- [ ] `pnpm typecheck` reports no errors
