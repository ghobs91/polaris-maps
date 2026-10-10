## Context

`react-native-bare-kit` embeds the Bare runtime and runs JS bundles in a worklet thread. Bundles produced by `bare-pack --linked` reference native addons via `bare-addon-resolve`, which loads them from `.xcframework`s vendored into the app. The kit's podspec vendors `ios/*.xcframework` and `ios/addons/*.xcframework`; the kit ships `ios/link.mjs` (which calls `bare-link`) to produce them. In this repo neither that step nor `bare-link`'s scan root worked under pnpm, so no addon was ever vendored and worklet start aborts.

## Goals / Non-Goals

**Goals:** vendor the needed addons reproducibly before `pod install`; make worklet start succeed; cover both worklets with one link pass.
**Non-Goals:** Android hosts; a signing strategy beyond Xcode's embed-and-sign; removing the pure-JS option as a future fallback.

## Decisions

**D1 — Use `bare-link` (the supported mechanism) over reworking to pure JS.** It matches how the kit is designed to load addons and unblocks `sodium-native` and `rocksdb-native` together.

**D2 — Scan the `backend/` worklet package.** All addons (`sodium-native`, `rocksdb-native`, `udx-native`, …) are transitively installed under `backend/node_modules` (the self-contained bare-pack package), so a single `bare-link backend` pass finds them.

**D3 — Generate into `react-native-bare-kit/ios/addons`.** The podspec already globs that directory, so `pod install` vendors and Xcode embeds them with no Podfile change.

**D4 — Run the link at prebuild (plugin) and before pod install (script).** A `withBareAddons` config plugin runs during `expo prebuild` (before `pod install`); the `bare:link` script + `ios:pods` hook cover flows that reuse an existing native project.

**D5 — Target the pnpm symlink.** `bare-link --out node_modules/react-native-bare-kit/ios/addons` writes through the direct-dependency symlink into the store package.

**D6 — Signing.** `bare-link` ad-hoc signs the frameworks; Xcode re-signs on embed for device builds. A dedicated identity can be added via `bare-link --sign --identity` if needed.

## Risks / Trade-offs

- **[node_modules is ephemeral]** → the plugin + `bare:link` regenerate on install/prebuild; addons are not committed.
- **[Size]** → `rocksdb-native` is ~26 MB (device + both simulator slices); acceptable for a dev/test build, optimize later via host-specific slices.
- **[pnpm layout drift]** → the plugin calls `pnpm exec bare-link` and targets the symlink; a future layout change is caught by the prebuild log.
- **[Android]** → not wired here; add `android` hosts + the kit's Android addon mechanism in a follow-up.

## Migration Plan

1. Add `bare-link` dev dep + `bare:link` script; register `withBareAddons`.
2. Link addons and `pod install`.
3. Native rebuild; enable the Hyperdrive worklet flag and verify it loads.
4. Rollback: disable the worklet flag (worklet stays off; app unaffected).

## Open Questions

- Whether to commit host-specific addon slices to speed CI (vs regenerating).
- Android addon host wiring.
