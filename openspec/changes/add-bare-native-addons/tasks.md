## 1. Link wiring

- [x] 1.1 Add `bare-link` as a dev dependency and a `bare:link` script targeting `node_modules/react-native-bare-kit/ios/addons` from `backend`
- [x] 1.2 Add the `withBareAddons` config plugin (runs `bare-link` during prebuild) and register it in `app.json`
- [x] 1.3 Run `bare:link` before `pod install` via the `ios:pods` script

## 2. Generate and integrate

- [x] 2.1 Produce the addon xcframeworks with `bare-link --preset ios` (rocksdb-native, sodium-native, udx-native, …)
- [x] 2.2 `pod install` vendors them through the react-native-bare-kit podspec

## 3. Verify

- [ ] 3.1 Native rebuild succeeds with the vendored addons embedded
- [ ] 3.2 Enable the Hyperdrive worklet (`EXPO_PUBLIC_BARE_HYPERDRIVE_WORKLET=1`) and confirm it starts without SIGABRT
- [ ] 3.3 Complete the `us-ny-new-york` publish + seed/download smoke test
