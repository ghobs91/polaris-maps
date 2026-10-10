## ADDED Requirements

### Requirement: Bare native addons are vendored before pod install

The app SHALL vendored the native addons required by its Bare worklets into `react-native-bare-kit/ios/addons` before `pod install`, so the podspec's `vendored_frameworks` picks them up.

#### Scenario: Addons present at pod install

- **WHEN** CocoaPods installs the app's pods
- **THEN** the Bare addon `.xcframework`s are already present in `react-native-bare-kit/ios/addons`

### Requirement: Reproducible linking

The linking SHALL be reproducible from a clean checkout via a script and a prebuild config plugin, without manual steps.

#### Scenario: Prebuild links the addons

- **WHEN** the project is prebuilt (`expo prebuild` / `run:ios`)
- **THEN** the `withBareAddons` plugin runs `bare-link` for the backend worklet package before pods are installed

#### Scenario: Non-prebuild flow links the addons

- **WHEN** the developer runs `pnpm ios:pods`
- **THEN** the `bare:link` script runs before `pod install`

### Requirement: Worklets can load their addons

After linking, a Bare worklet that links a native addon SHALL start without aborting.

#### Scenario: Hyperdrive worklet loads rocksdb-native

- **WHEN** the Hyperdrive worklet is enabled and started
- **THEN** it loads `rocksdb-native` and handles RPC without a native abort
