## Why

The Bare worklets (traffic + Hyperdrive) link native addons — `sodium-native` (Hyperswarm), `rocksdb-native` (Corestore/Hyperdrive), `udx-native`, … — that `react-native-bare-kit` can only load from `.xcframework`s vendored into the app (`ios/addons`, produced by `bare-link`). That step was never run, so starting the Hyperdrive worklet aborted with **SIGABRT** (`rocksdb-native` unresolvable), and the traffic worklet's `sodium-native` was never loadable either. This is the prerequisite ("step 0") for all Bare P2P.

## What Changes

- Vendor the Bare native addons with `bare-link` into `react-native-bare-kit/ios/addons`, where the podspec's `vendored_frameworks = "ios/addons/*.xcframework"` picks them up.
- Add a `withBareAddons` Expo config plugin that runs `bare-link` (scanning the `backend/` worklet package) during prebuild, before `pod install`.
- Add `bare-link` as a dev dependency, a `bare:link` script, and a pre-`pod install` hook in `ios:pods` for non-prebuild flows.
- Verify the Hyperdrive worklet now loads (`rocksdb-native`) and can be enabled.

Out of scope: Android addon hosts; custom signing identities (Xcode embeds/signs the vendored frameworks at build).

## Capabilities

### New Capabilities

- `bare-native-addons`: Reproducible vendoring of Bare native addons into the app so `react-native-bare-kit` worklets can load them.

### Modified Capabilities

<!-- None. -->

## Impact

- **Plugin**: `plugins/withBareAddons.js` (new), registered in `app.json`.
- **Scripts/deps**: `package.json` (`bare:link`, `ios:pods`, `bare-link` dev dep), `pnpm-lock.yaml`.
- **Native**: `react-native-bare-kit/ios/addons/*.xcframework` (generated, gitignored under node_modules); regenerated Pods xcconfigs.
- **Consumers**: `hyperdriveBridge.ts` worklet can be enabled (`EXPO_PUBLIC_BARE_HYPERDRIVE_WORKLET=1`) and traffic P2P gains its addon.
- **Requires**: `backend` worklet deps installed (`cd backend && npm install`) before linking.
