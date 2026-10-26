# iOS Local Development & Release Guide — Polaris Maps

This guide explains how to build, test, and release the Polaris Maps iOS app **locally on macOS** without depending on hosted EAS Build quotas.

## Why Local Builds?

- **No EAS build quota limits:** The free EAS plan has limited build minutes per month. Local builds are unlimited.
- **Faster iteration:** `expo run:ios` rebuilds in seconds vs. minutes for a hosted build.
- **Full Xcode access:** Debug with Instruments, check signing, inspect archives.
- **Offline capable:** No internet needed for development builds (only TestFlight uploads need connectivity).

Hosted EAS Build remains available as a fallback for CI or when you specifically need EAS features.

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Polaris Maps App                                │
│  ┌───────────┐  ┌──────────────┐  ┌───────────┐ │
│  │ Expo SDK  │  │ Custom Native │  │ Fastlane  │ │
│  │ (JS/TS)   │  │ Modules      │  │ (automation)│
│  │           │  │ MapKit       │  │ beta lane  │ │
│  │           │  │ Valhalla     │  │ release    │ │
│  └───────────┘  └──────────────┘  └───────────┘ │
│         │              │               │         │
│         └──────────────┴───────────────┘         │
│                        │                         │
│              Xcode + CocoaPods                   │
│              (local macOS build)                 │
│                        │                         │
│          ┌─────────────┴─────────────┐           │
│          │    .ipa archive           │           │
│          └─────────────┬─────────────┘           │
│                        │                         │
│              App Store Connect                   │
│              (TestFlight / Release)              │
└─────────────────────────────────────────────────┘
```

## Prerequisites

- macOS with **Xcode 16+** installed (download from App Store)
- A **release** (or RC) Xcode for TestFlight uploads — App Store Connect rejects
  binaries built with a beta Xcode/SDK (`Unsupported SDK or Xcode version`, code
  `90534`). If you also have `Xcode-beta.app`, force the release toolchain with
  `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` for archive/export/upload.
- **pnpm** (the project's package manager)
- **Ruby** (system Ruby is fine)
- **Bundler** (`gem install bundler` if not present)
- **Apple Developer Program** membership ($99/year)
- **App Store Connect** app record for `com.polarismaps.app`

## Quick Start

```bash
# 1. Install dependencies
pnpm install --frozen-lockfile
bundle install

# 2. Copy the environment file (worktrees do NOT share it)
cp <primary-checkout>/.env .env

# 3. Install CocoaPods
cd ios && bundle exec pod install && cd ..

# 4. Run on simulator
pnpm ios

# 5. Run on physical device
npx expo run:ios --device
```

## Release Preflight (enforced)

`EXPO_PUBLIC_*` values are inlined into the JS bundle at build time from the
repo-root `.env`. A release build without that file still installs and runs, but
it ships with no traffic key, no transit keys and no region catalog — the map
shows "No traffic data" everywhere because the traffic cascade has no source
left (no TomTom seed, no open feeds, no peers).

Builds 318–328 shipped this way: they were archived from feature worktrees that
had no `.env`. The `beta` and `release` lanes now refuse to proceed unless all
of these hold:

| Check                                      | Lane step                       | Override                     |
| ------------------------------------------ | ------------------------------- | ---------------------------- |
| `.env` exists at the repo root             | `ensure_app_env`                | none — copy the file         |
| `EXPO_PUBLIC_TOMTOM_API_KEY` is non-blank  | `ensure_app_env`                | none — set the key           |
| `HEAD` is `main`                           | `ensure_release_source`         | `POLARIS_ALLOW_NON_MAIN=1`   |
| working tree is clean                      | `ensure_release_source`         | `POLARIS_ALLOW_DIRTY=1`      |
| the key is in the exported `main.jsbundle` | `verify_bundle_has_traffic_key` | none — fix the bundling step |

Merge work into `main` before archiving. A release built from an unmerged
branch is a binary nobody can reproduce from `main`.

## Development Workflow

### Daily Development

```bash
# Start Metro + run on simulator
pnpm ios

# Run on a connected iPhone
npx expo run:ios --device

# Open Xcode for debugging
xed ios

# TypeScript validation
pnpm typecheck

# Lint
pnpm lint

# Tests
pnpm test
```

### When Dependencies Change

```bash
# After adding/updating Expo packages or native dependencies
pnpm install --frozen-lockfile
cd ios && bundle exec pod install && cd ..
```

### When Expo Configuration Changes

If you modify `app.json`, `eas.json`, or add/remove config plugins:

```bash
npx expo prebuild
cd ios && bundle exec pod install && cd ..
```

**⚠️ Warning:** `expo prebuild` regenerates native files. Custom Swift code in `ios/PolarisMaps/` is preserved because it's outside the generated directories, but verify that no native build settings were overwritten after running prebuild.

## Apple Signing

### Xcode Automatic Signing (Recommended)

Polaris Maps uses Xcode automatic signing. You should not need to manually manage certificates or provisioning profiles.

1. Open the project: `xed ios`
2. Select **PolarisMaps** target → **Signing & Capabilities**
3. Ensure **"Automatically manage signing"** is checked
4. Select your team from the dropdown

Xcode handles:

- Creating development/distribution certificates
- Generating provisioning profiles
- Registering devices when you first connect them

### App Capabilities

The app uses these entitlements (configured in `ios/PolarisMaps/PolarisMaps.entitlements`):

- Location (always and when-in-use)
- Camera access
- Speech recognition
- Photo library access
- iCloud Documents (place lists / favorites sync via the app's ubiquity container)

### iCloud capability (one-time portal setup)

The `withCloudStore` plugin adds `com.apple.developer.ubiquity-container-identifiers`
(`iCloud.com.polarismaps.app`) to the entitlements. This requires, in the Apple
Developer portal:

1. **iCloud** enabled for the App ID (`com.polarismaps.app`), with **iCloud
   Documents** checked.
2. A container named **`iCloud.com.polarismaps.app`** assigned to that App ID.
3. Regenerate/download the provisioning profile so it carries the new
   entitlement (Xcode automatic signing usually does this on the next build).

Without this, the app builds but signing fails, and `isAvailable()` returns
`false` at runtime (sync is skipped; local MMKV data is unaffected).

## TestFlight Builds

### Option 1: Fastlane (Recommended)

```bash
# Set up once
export APP_STORE_CONNECT_KEY_ID="your_key_id"
export APP_STORE_CONNECT_ISSUER_ID="your_issuer_id"
export APP_STORE_CONNECT_KEY_PATH="$HOME/.appstoreconnect/private_keys/AuthKey_XXXXXX.p8"

# Build and upload
pnpm ios:beta
```

> **Keep the `.p8` in `~/.appstoreconnect/private_keys/` — never in `~/Downloads`,
> `~/Desktop`, or `~/Documents`.** macOS TCC (privacy protection) gates those folders:
> a process can `stat` the key but fail to open it with `Operation not permitted`
> (`rb_sysopen`), and the grant is reset periodically (app updates, signing changes).
> That produces a recurring "API key mismatch" that is really a **permissions** failure
> — the key ID and issuer are usually still correct. `~/.appstoreconnect/private_keys/`
> is not TCC-gated and is where `altool`/Xcode look by default. Note API keys are
> **download-once**: if the `.p8` is truly lost you must create a new key, which gets a
> new `KEY_ID` (the `ISSUER_ID` is team-wide and does not change).

**What happens:**

1. Project validation (expo doctor)
2. Dependencies installed
3. CocoaPods installed
4. Build number auto-incremented
5. Xcode archive build (local, ~5-10 min)
6. Upload to TestFlight

### Option 2: Xcode

1. `xed ios`
2. Select scheme: **PolarisMaps**
3. Destination: **Any iOS Device (arm64)**
4. Product → Archive
5. In Organizer: Distribute App → App Store Connect → Upload

### Option 3: Local EAS Build

```bash
eas build --platform ios --profile production --local
```

Requires Docker. Produces the same output as hosted EAS but runs locally.

### Option 4: Hosted EAS Build (consumes quota)

```bash
eas build --platform ios --profile production --auto-submit
```

Only use when you specifically need EAS infrastructure.

## App Store Release

Releasing to the App Store is **always a manual process** — no automation will submit for App Review or release publicly.

### Release Checklist

1. **Validate the project:**

   ```bash
   pnpm lint && pnpm typecheck && pnpm test
   ```

2. **Bump the marketing version** in `app.json` (e.g., `"version": "0.2.0"`)

3. **Build and upload:**

   ```bash
   pnpm ios:release
   ```

4. **Wait for processing** (check App Store Connect → TestFlight for build status, ~15-30 min)

5. **In App Store Connect:**
   - Go to **App Store → iOS App**
   - Select the new build under **Build**
   - Update **What's New in This Version** (release notes)
   - Update screenshots if needed
   - Complete **Export Compliance** questionnaire
   - Update **App Privacy** details if changed
   - Click **Submit for Review**

6. **After approval:**
   - The build is set to **"Manually release"**
   - Click **Release This Version** when ready

### Version Numbers

- **Marketing version** (`0.1.0`): Managed in `app.json` → `expo.version`. Bump manually when cutting a release. This is what ships in `CFBundleShortVersionString`; the Xcode `MARKETING_VERSION` build setting is overridden by the embedded Expo config.
- **Build number** (`CFBundleVersion`): App Store Connect is the single source of truth. Resolve it before archiving and let export keep it:
  - `node scripts/next-build-number.mjs --set` queries ASC for the highest build on `com.polarismaps.app`, takes the project's current value as a floor, applies `max(asc, local) + 1` via `agvtool`, and prints the number. Run it **before** archiving.
  - `ExportOptions.plist` sets `manageAppVersionAndBuildNumber` to `false`, so `-exportArchive` no longer rewrites the number. The project, the archive, and the shipped IPA all carry the same value — what the archive says is what ships.
  - Do **not** use a bare `xcrun agvtool bump -all`. It counts locally, and this repo runs several worktrees at once: a local counter collides with builds uploaded from another worktree or machine, and with export auto-management it silently produced a different shipped number than the archive carried.
  - The Fastlane `beta` lane resolves the number the same way (`latest_testflight_build_number + 1` in `bump_build`) and passes `manageAppVersionAndBuildNumber: false` to `build_app`, so both paths agree.
  - If ASC cannot be reached, the script exits non-zero rather than guessing: a wrong number only fails at upload, after a full build.
  - Marketing version `0.1.0` is separate — see above.

## GitHub Actions (Optional CI)

The repository includes `.github/workflows/ios-testflight.yml` for optional CI builds on a Mac runner.

### Setting Up CI

1. Add these secrets to GitHub (Settings → Secrets and variables → Actions):
   - `APP_STORE_CONNECT_KEY_ID`
   - `APP_STORE_CONNECT_ISSUER_ID`
   - `APP_STORE_CONNECT_PRIVATE_KEY` (full `.p8` file contents)

2. Trigger from GitHub Actions tab → "iOS TestFlight Build" → Run workflow

### Self-Hosted Runner

For a dedicated Mac mini/Mac Studio:

1. Add the runner in GitHub → Settings → Actions → Runners
2. Install pnpm, Ruby, Bundler, CocoaPods on the machine
3. Set the environment variables
4. Change the workflow to use `runs-on: self-hosted`

## Command Reference

| Task                     | Command                                                 | Uses EAS? | Uploads?     |
| ------------------------ | ------------------------------------------------------- | --------- | ------------ |
| Install deps             | `pnpm install --frozen-lockfile`                        | No        | No           |
| Run on simulator         | `pnpm ios`                                              | No        | No           |
| Run on device            | `npx expo run:ios --device`                             | No        | No           |
| Open Xcode               | `xed ios`                                               | No        | No           |
| TypeScript check         | `pnpm typecheck`                                        | No        | No           |
| Lint                     | `pnpm lint`                                             | No        | No           |
| Tests                    | `pnpm test`                                             | No        | No           |
| Expo doctor              | `npx expo doctor`                                       | No        | No           |
| Update native project    | `npx expo prebuild`                                     | No        | No           |
| Update CocoaPods         | `cd ios && bundle exec pod install`                     | No        | No           |
| TestFlight (Fastlane)    | `pnpm ios:beta`                                         | No        | Yes (upload) |
| Release build (Fastlane) | `pnpm ios:release`                                      | No        | Yes (upload) |
| Local EAS build          | `eas build --platform ios --profile production --local` | No        | No           |
| **Hosted EAS build**     | `eas build --platform ios --profile production`         | **YES**   | Optional     |

## Common Issues

### "PhaseScriptExecution failed" during Xcode build

Set `ENABLE_USER_SCRIPT_SANDBOXING = NO` in the Xcode project build settings. This is already configured in the project's `Podfile` post-install hook.

### "Module 'Expo' has a minimum deployment target of iOS 16.4"

Check that `IPHONEOS_DEPLOYMENT_TARGET` is set to `16.4` in **all** build configurations (both project-level and target-level in Xcode). Also verify `ios/Podfile` has `platform :ios, '16.4'`.

### Metro bundler hangs or serves stale code

```bash
node scripts/clear-metro-cache.js
pnpm ios
```

### CocoaPods fails after package changes

```bash
cd ios
rm -rf Pods Podfile.lock
bundle exec pod install --repo-update
cd ..
```

### "The app identifier cannot be registered because it is not available"

The bundle ID is already registered to another team or you don't have permission. Check App Store Connect → App Information → Bundle ID.

### Fastlane "Authentication failed"

Verify your API key is not expired and has the **App Manager** role. Test with:

```bash
bundle exec fastlane spaceauth -u your@apple.id
```

### Key file "Operation not permitted" (rb_sysopen), or `test -r` reports it missing

The `.p8` is in a **TCC-protected folder** (`~/Downloads`, `~/Desktop`, `~/Documents`).
macOS privacy protection lets `stat` read metadata but blocks opening the file, so the
key looks missing or wrong when it isn't. Move it to `~/.appstoreconnect/private_keys/`
and update `APP_STORE_CONNECT_KEY_PATH`. Do **not** regenerate the key — the `KEY_ID`
is fine. Granting Full Disk Access to your terminal also works but storing keys outside
protected folders is the durable fix.

### Upload fails with "Unsupported SDK or Xcode version" (code 90534)

The archive was built with a **beta** Xcode/SDK. Rebuild with the release Xcode:

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  xcodebuild archive -workspace ios/PolarisMaps.xcworkspace -scheme PolarisMaps \
  -configuration Release -destination 'generic/platform=iOS' \
  -archivePath ios/build/App.xcarchive -derivedDataPath ios/build/DerivedData \
  -allowProvisioningUpdates
```

…and export/upload with the same `DEVELOPER_DIR`.

## Keeping EAS as a Fallback

Hosted EAS builds are still available when needed:

```bash
# Emergency hosted build (consumes quota)
eas build --platform ios --profile production --auto-submit
```

The `eas.json` configuration is unchanged. Use hosted builds when:

- Your local Mac is unavailable
- You need a clean CI-like build environment for debugging
- You want to use EAS-specific features like `eas update`
