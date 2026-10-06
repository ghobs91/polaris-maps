# App Store submission — checklist

Status of the work needed to submit Polaris Maps to the public App Store.

## Scope decision

**v1 ships iOS only. Android is deferred.**

Rationale: the Android release build is still signed with the debug keystore
(`android/app/build.gradle`), uses `versionCode 1`, and has no Play Store
pipeline or metadata. Shipping it would require a production keystore, a Play
account, Data Safety answers, and a background-location justification form. None
of that is tracked here, so the first public release targets iOS.

## Pre-submission checklist

| Item                                       | Status | Notes                                                                     |
| ------------------------------------------ | ------ | ------------------------------------------------------------------------- |
| Release quality gate (`pnpm check`)        | ✅     | Jest config fixed; 0 lint warnings; 1,784 tests pass                      |
| `ios release` lane runs                    | ✅     | Stale MapKit env gate removed; version-drift guard added                  |
| Privacy manifest (`PrivacyInfo.xcprivacy`) | ✅     | Four collected data types declared; `NSPrivacyTracking = false`           |
| App Privacy questionnaire answers          | ✅     | Drafted in `docs/app-store-privacy-answers.md`                            |
| Privacy & Terms content                    | ✅     | `docs/privacy-policy.md`; served from `netlify-deploy/`                   |
| Store listing copy                         | ✅     | `fastlane/metadata/en-US/`                                                |
| **Host policy at polarismaps.app**         | ⬜     | Must resolve before review; deploy `netlify-deploy/privacy`               |
| **Review contact + screenshots**           | ⬜     | Fill `review_information/` and capture shots (see `fastlane/screenshots`) |
| **Fill `<DATE>` / `<CONTACT EMAIL>`**      | ⬜     | In the policy, terms, and metadata footer                                 |
| Universal links on `polarismaps.app`       | 🟡     | Source + AASA migrated; AASA deploy + Apple capability/profile pending    |

## Version

`app.json` → `expo.version` is the source of truth for the marketing version
(currently `0.1.0`). The shipped value lives in `ios/PolarisMaps/Info.plist`
(`CFBundleShortVersionString`), which is **hard-coded** — bumping `app.json`
alone will not change the binary. Run `npx expo prebuild` or update the plist,
then confirm with `bundle exec fastlane ios release` (the `verify_version_alignment`
preflight warns on drift).

## Universal links (`polarismaps.app`)

The canonical domain is `polarismaps.app`. The source has been migrated:

- `src/services/places/shareService.ts` → `PLACE_LINK_HOST = 'polarismaps.app'`
- `plugins/withUniversalLinks.js` → `applinks:polarismaps.app`
- `netlify-deploy/.well-known/apple-app-site-association` declares
  `XTXZ3CYRPX.com.polarismaps.app` for `/p/*` and `/p`.

Three things remain, all outside the app code, before links open the app:

1. **Deploy** the AASA file so
   `https://polarismaps.app/.well-known/apple-app-site-association` resolves
   with `Content-Type: application/json`.
2. **Enable the Associated Domains capability** for App ID
   `com.polarismaps.app` in the Apple Developer portal and **regenerate the App
   Store provisioning profile**. The committed profile
   (`AppStore_com.polarismaps.app.mobileprovision`) does **not** include
   `com.apple.developer.associated-domains`, so adding the entitlement now would
   fail signing.
3. **Apply the entitlement** (`npx expo prebuild` runs the `withUniversalLinks`
   plugin, or add
   `com.apple.developer.associated-domains = ["applinks:polarismaps.app"]` to
   `ios/PolarisMaps/PolarisMaps.entitlements`) and re-sign.

Until then, shared place links fall back to the `polaris-maps://` scheme and the
app still resolves them; only the https universal-link entry point is inactive.

## Submission path (iOS)

1. Host the privacy policy and terms so both URLs resolve.
2. Fill review contact info and capture screenshots.
3. `bundle exec fastlane ios release` → uploads the build to App Store Connect.
4. Complete App Privacy + listing metadata in App Store Connect (or run
   `fastlane deliver`).
5. Submit for App Review manually.
