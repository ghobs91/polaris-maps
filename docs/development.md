# Development Guide — Polaris Maps

## Prerequisites

- **Node.js ≥ 20** (CI pins Node 22)
- **pnpm ≥ 9** (CI uses latest pnpm via `pnpm/action-setup`)
- **Xcode 16+** (iOS; `docs/ios-release.md` says Xcode 16+), **CocoaPods**, **Ruby + Bundler** (Fastlane)
- **Android Studio** (Android)
- **Apple Developer Program** membership (iOS release/TestFlight only)

## Install

```bash
pnpm install          # postinstall runs scripts/patch-atproto-oauth.mjs
cd ios && bundle exec pod install && cd ..   # iOS pods (or: pnpm ios:pods)
```

`backend/` is a separate npm package (its own `package-lock.json`); install its deps only when rebuilding the worklet bundle:

```bash
cd backend && npm install && cd ..
pnpm swarm:bundle     # rebuild backend/traffic-swarm.bundle.mjs (commit the result)
```

## Environment Setup

- Copy `.env.example` to `.env` (`.env` is gitignored; never commit it).
- Required public vars: `EXPO_PUBLIC_TOMTOM_API_KEY`, `EXPO_PUBLIC_HERE_API_KEY` (optional: `EXPO_PUBLIC_TOMTOM_PROXY_URL`).
- `EXPO_PUBLIC_*` vars are inlined by Metro at bundle time; restart Metro after changing them.
- Full var list: see `AGENTS.md` → Environment & Secrets.

## Running Locally

```bash
pnpm start        # Metro bundler
pnpm ios          # iOS Simulator
pnpm ios:device   # iOS device
pnpm android      # Android Emulator
```

## Test / Lint / Format / Typecheck / Build

```bash
pnpm test                    # Jest unit tests
pnpm test:watch              # Jest watch mode
pnpm test:integration        # Jest integration (config file was missing at audit — see below)
pnpm test:contract           # Jest contract (config file was missing at audit)
pnpm test:benchmark          # Benchmarks (config file was missing at audit)
pnpm lint                    # ESLint 9 flat config (eslint.config.mjs, ts/tsx only)
pnpm format                  # Prettier write
pnpm format:check            # Prettier check
pnpm typecheck               # tsc --noEmit (strict, @/* → src/*)
pnpm check                   # lint + format:check + typecheck + test
```

- **Known issue**: the test suite has pre-existing failures (Jest ESM transform config + unrelated unit failures). CI runs `pnpm test` as advisory (`continue-on-error: true`). Do not assume green; report actual results.
- `test:integration`, `test:contract`, `test:benchmark` reference `jest.*.config.js` files that were not present in the repo at last audit; `test:e2e:*` (Detox) reference configurations with no `.detoxrc` found. These may fail until restored.

## iOS Build & Release

Local builds via Fastlane (no EAS build quota): see `docs/ios-release.md` and `fastlane/Fastfile`.

```bash
pnpm ios:beta       # build + upload TestFlight
pnpm ios:release    # build + upload for App Store release
pnpm ios:validate   # validate lane setup
```

Requires App Store Connect env vars: `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`, `APP_STORE_CONNECT_KEY_PATH` (.p8). CI mirror: `.github/workflows/ios-testflight.yml` (manual dispatch).

## CarPlay Simulator

```bash
pnpm carplay:sim      # install CarPlay simulator app
pnpm carplay:resign   # resign without rebuild
pnpm carplay:doctor   # diagnose simulator setup
```

## Region Data

Built weekly by CI (`.github/workflows/build-region-data.yml`) and published to GitHub Releases; the app downloads via GitHub Releases or Hyperdrive P2P.

```bash
sh scripts/generate-region-data.sh      # single region
sh scripts/generate-all-regions.sh      # catalog regions (scripts/regions.json)
sh scripts/build-region-bundle.sh       # bundle a region pack
```

## Debugging

- Metro logs appear in the terminal running `pnpm start`.
- `pnpm start --clear` or `node scripts/clear-metro-cache.js` clears stale Metro cache.
- Local debugging logs/artifacts at repo root (`output.log`, `proxy.log`, `carplay_sim.log`, `build_output*.txt`) are gitignored.
- Detox e2e for user flows (iOS simulator / Android emulator) — config may be missing (see above).

## Common Failure Modes

| Symptom                                                                  | Likely cause / fix                                                                                        |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Jest ESM transform errors                                                | Pre-existing suite issue (documented in CI comment). Not fixed at audit time.                             |
| `test:integration` / `test:contract` / `test:benchmark` fail immediately | Missing `jest.*.config.js` files. Restore before relying on them.                                         |
| Detox e2e fails to start                                                 | No `.detoxrc` found in repo at audit time.                                                                |
| Stale bundle behavior after env changes                                  | Metro caches env inlining; restart Metro / clear cache.                                                   |
| Xcode build number conflicts on TestFlight                               | Fastlane `bump_build` lane handles this (`fastlane/Fastfile`).                                            |
| Worklet bundle out of date                                               | Rebuild with `pnpm swarm:bundle` and commit `backend/traffic-swarm.bundle.mjs`.                           |
| `pnpm prebuild` wipes native changes                                     | `expo prebuild --clean` regenerates `ios/` + `android/`; use config plugins, don't hand-edit native dirs. |

## Verification Checklist Before Committing

1. `pnpm typecheck` — clean.
2. `pnpm lint` — clean.
3. `pnpm format:check` — clean (husky pre-commit enforces 2 + 3).
4. Ran the most relevant tests for the changed area; reported actual results.
5. Commit message follows Conventional Commits (commitlint hook).
6. No secrets, `.env`, or generated native dirs staged.
