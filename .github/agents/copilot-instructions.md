# polaris-maps Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-03-05

## Active Technologies

- TypeScript ~5.6 (strict mode, no `any` in new code) + React Native 0.76 + Expo 52, @maplibre/maplibre-react-native 10.x, Zustand 5.x, expo-location (002-traffic-flow-eta)
- expo-sqlite (existing), react-native-mmkv (existing), in-memory Zustand stores (002-traffic-flow-eta)

- TypeScript 5.x (React Native JS layer), C++ (Valhalla native module), Objective-C/Swift (iOS native bridges), Kotlin/Java (Android native bridges) + React Native 0.76+, Expo SDK 52+ (bare workflow), @maplibre/maplibre-react-native, Valhalla (compiled as native module), Waku v2 (via nodejs-mobile-react-native sidecar), Gun.js, react-native-bare-kit (Hypercore/Holepunch), expo-sqlite, Zustand, react-native-mmkv, @noble/secp256k1 (Nostr keypair) (001-p2p-depin-mapping)

## Project Structure

```text
src/
tests/
```

## Commands

npm test && npm run lint

## Code Style

TypeScript 5.x (React Native JS layer), C++ (Valhalla native module), Objective-C/Swift (iOS native bridges), Kotlin/Java (Android native bridges): Follow standard conventions

## Recent Changes

- 002-traffic-flow-eta: Added TypeScript ~5.6 (strict mode, no `any` in new code) + React Native 0.76 + Expo 52, @maplibre/maplibre-react-native 10.x, Zustand 5.x, expo-location

- 001-p2p-depin-mapping: Added TypeScript 5.x (React Native JS layer), C++ (Valhalla native module), Objective-C/Swift (iOS native bridges), Kotlin/Java (Android native bridges) + React Native 0.76+, Expo SDK 52+ (bare workflow), @maplibre/maplibre-react-native, Valhalla (compiled as native module), Waku v2 (via nodejs-mobile-react-native sidecar), Gun.js, react-native-bare-kit (Hypercore/Holepunch), expo-sqlite, Zustand, react-native-mmkv, @noble/secp256k1 (Nostr keypair)

<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
