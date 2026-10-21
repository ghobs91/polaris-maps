# App Store submission — checklist

Status of the work needed to submit Polaris Maps to the public App Store.

## Scope

**v1 ships iOS only.** Android is **out of scope for now** (its release build is
still debug-signed with no Play pipeline) and is intentionally omitted below.

## Status at a glance

### Done

| Item                                    | Evidence                                                              |
| --------------------------------------- | --------------------------------------------------------------------- |
| Release quality gate (`pnpm check`)     | Jest config fixed; 0 lint warnings; 2,045 tests pass                  |
| `ios release` lane runs                 | Stale MapKit env gate removed; version-drift guard added              |
| Privacy manifest                        | `PrivacyInfo.xcprivacy`: 4 collected types, `NSPrivacyTracking=false` |
| Privacy policy + terms + landing page   | Live: https://app.polarismaps.app/privacy, `/terms`, `/`              |
| Support & marketing URLs                | Point at https://app.polarismaps.app (resolve 200)                    |
| Store listing copy                      | `fastlane/metadata/en-US/`                                            |
| Review contact fields                   | `fastlane/metadata/review_information/` (name, email, phone)          |
| Policy/terms date + contact + copyright | Live: October 18, 2026 · support@polarismaps.app · © Andrew Ghobrial  |
| App Privacy questionnaire answers       | Drafted in `docs/app-store-privacy-answers.md`                        |
| Universal links — source + AASA         | `shareService`/plugin → `app.polarismaps.app`; AASA served 200 JSON   |
| Screenshots — iPhone 6.9" (7 of 8)      | `screenshots/out/01..07` (CarPlay card pending)                       |
| Screenshots — iPad 13" (1 card)         | `screenshots/out/ipad-01-explore.png` (2064×2752)                     |

### Remaining

| #   | Item                                                  | Owner                        | Status                               |
| --- | ----------------------------------------------------- | ---------------------------- | ------------------------------------ |
| 1   | CarPlay screenshot + card 8                           | you → me compose             | Paused (UI work)                     |
| 2   | iPad 13" screenshots (required)                       | you → me compose             | Paused (UI work)                     |
| 3   | Enter App Privacy answers in App Store Connect        | you                          | Drafted                              |
| 4   | Legal review of policy + terms                        | you                          | Review pending                       |
| 5   | Associated Domains capability + profile + entitlement | you (Apple Developer portal) | Entitlement applied; profile pending |
| 6   | Run `fastlane ios release` → submit                   | you                          | Lane unblocked                       |
| 7   | Housekeeping: commit working tree                     | you                          | Not started                          |

> Screenshots are **paused** while iPad/macOS layout improvements land in a
> separate worktree. Re-capture iPhone + iPad and re-render the cards after that
> work merges; the existing iPad card reflects the old layout.

---

## Detailed instructions

### 1. CarPlay card (screenshots/out/08-carplay.png)

1. Resolve SPM packages (done already if you followed the earlier fix) and run
   the CarPlay simulator install:
   ```bash
   sh scripts/install-carplay-simulator.sh      # or: pnpm carplay:sim
   ```
   The build needs the `com.apple.developer.carplay-maps` entitlement; without a
   CarPlay provisioning profile the script falls back to ad-hoc signing and may
   strip it (see task 5 for enabling capabilities).
2. Capture the CarPlay view and save it to `screenshots/raw/carplay.png`
   (any resolution; the compositor scales it into the device frame).
3. Re-render:
   ```bash
   python3 screenshots/compose.py        # writes 08-carplay.png
   python3 screenshots/contact_sheet.py  # refresh preview
   ```

### 2. iPad 13" screenshots (required)

`app.json` sets `ios.supportsTablet: true`, so App Store Connect requires iPad
screenshots (2064×2752 for iPad Pro 13").

1. Install the simulator build on an iPad simulator and capture dark-mode screens:
   ```bash
   IPAD=$(xcrun simctl list devices | grep "iPad Pro 13-inch (M5)" | head -1 | awk -F'[()]' '{print $2}')
   xcrun simctl boot "$IPAD"; xcrun simctl bootstatus "$IPAD" -b
   IPHONE=96939965-9B37-4E33-8A60-C02CDE35E4DD   # device that already has the app
   APP=$(xcrun simctl get_app_container "$IPHONE" com.polarismaps.app)
   xcrun simctl install "$IPAD" "$APP"
   xcrun simctl ui "$IPAD" appearance dark
   xcrun simctl status_bar "$IPAD" override --time "09:41" --batteryState charged --batteryLevel 100
   # capture:  xcrun simctl io "$IPAD" screenshot --type=png screenshots/raw/ipad-<name>.png
   ```
2. Provide the raw captures and I'll add an iPad variant to `compose.py`
   (2064×2752 canvas + iPad frame, same card style).

### 3. Enter App Privacy answers in App Store Connect

1. App Store Connect → your app → **App Privacy** → **Edit**.
2. Apply the answers from `docs/app-store-privacy-answers.md`:
   - Collected: **Precise Location** (not linked), **Photos or Videos** (linked),
     **Other User Content** (linked), **User ID** (linked) — all App Functionality.
   - Tracking: **No**.
3. Point the **Privacy Policy URL** at `https://app.polarismaps.app/privacy`.

### 4. Legal review of policy + terms

The placeholders are filled and the pages are redeployed: last updated
**October 18, 2026**, contact **support@polarismaps.app** (rendered as a
`mailto:` link), copyright **2026 Andrew Ghobrial**.

Remaining: have the privacy policy and terms reviewed. In particular, the
Terms currently have **no governing-law/jurisdiction clause**, and the policy
should be checked against actual data practices before launch.

### 5. Associated Domains capability + profile + entitlement

Source and hosting are ready; only the Apple-side steps remain.

1. Apple Developer → Certificates, Identifiers & Profiles → **Identifiers** →
   `com.polarismaps.app` → enable **Associated Domains** → Save.
2. **Profiles** → the App Store profile for the app → **Edit** → regenerate →
   download; replace `AppStore_com.polarismaps.app.mobileprovision` (or let Xcode
   manage signing).
3. Apply the entitlement — either run `npx expo prebuild` (runs the
   `withUniversalLinks` plugin) or add to
   `ios/PolarisMaps/PolarisMaps.entitlements`:
   ```xml
   <key>com.apple.developer.associated-domains</key>
   <array><string>applinks:app.polarismaps.app</string></array>
   ```
4. Confirm the AASA is live:
   `https://app.polarismaps.app/.well-known/apple-app-site-association` → 200
   `application/json` (already verified).

> The entitlement is now applied to `PolarisMaps.entitlements` and
> `PolarisMaps.Debug.entitlements`. The profile on this Mac still predates the
> capability, so regenerate/install it (or let Xcode auto-provision with
> `-allowProvisioningUpdates`) before the release build; otherwise signing fails.

### 6. Build and submit

1. Confirm `.env` has `APP_STORE_CONNECT_KEY_ID`, `..._ISSUER_ID`, `..._KEY_PATH`
   (present) and that signing is available (`match` or `SKIP_MATCH=1`).
2. Optionally confirm the version: `app.json` `version` is the source of truth
   (`0.1.0`); the shipped `CFBundleShortVersionString` lives in
   `ios/PolarisMaps/Info.plist` and is hard-coded — `fastlane ios release` warns
   on drift.
3. Run:
   ```bash
   pnpm ios:release          # fastlane ios release — uploads to App Store Connect
   ```
4. In App Store Connect: select the build, add release notes, complete App
   Privacy + listing metadata, then **Submit for Review** (manual).

### 7. Housekeeping

The working tree has two uncommitted files: `ios/PolarisMaps.xcodeproj/project.pbxproj`
and `ios/PolarisMaps/Info.plist` (build-number/version edits). Reconcile or
commit them before the release build.
