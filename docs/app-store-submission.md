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
| Host policy/terms                          | ✅     | Live at https://app.polarismaps.app/privacy (+ /terms)                    |
| Support & marketing URLs                   | ✅     | Landing + support live at https://app.polarismaps.app                     |
| **Review contact + screenshots**           | ⬜     | Fill `review_information/` and capture shots (see `fastlane/screenshots`) |
| **Fill `<DATE>` / `<CONTACT EMAIL>`**      | ⬜     | In the policy, terms, and metadata footer                                 |
| Universal links on `app.polarismaps.app`   | 🟡     | Source + AASA live; Apple capability + profile + entitlement pending      |

## Version

`app.json` → `expo.version` is the source of truth for the marketing version
(currently `0.1.0`). The shipped value lives in `ios/PolarisMaps/Info.plist`
(`CFBundleShortVersionString`), which is **hard-coded** — bumping `app.json`
alone will not change the binary. Run `npx expo prebuild` or update the plist,
then confirm with `bundle exec fastlane ios release` (the `verify_version_alignment`
preflight warns on drift).

## Universal links (`app.polarismaps.app`)

The only hosted domain is `app.polarismaps.app`, so place links and the
associated domain point there. Source and hosting are done:

- `src/services/places/shareService.ts` → `PLACE_LINK_HOST = 'app.polarismaps.app'`
- `plugins/withUniversalLinks.js` → `applinks:app.polarismaps.app`
- `netlify-deploy/.well-known/apple-app-site-association` is deployed and serves
  `XTXZ3CYRPX.com.polarismaps.app` for `/p/*` and `/p` as `application/json`.

Two steps remain, both in the Apple Developer portal:

1. **Enable the Associated Domains capability** for App ID
   `com.polarismaps.app` and **regenerate the App Store provisioning profile**.
   The committed profile (`AppStore_com.polarismaps.app.mobileprovision`) does
   **not** include `com.apple.developer.associated-domains`, so adding the
   entitlement now would fail signing.
2. **Apply the entitlement** (`npx expo prebuild` runs the `withUniversalLinks`
   plugin, or add
   `com.apple.developer.associated-domains = ["applinks:app.polarismaps.app"]`
   to `ios/PolarisMaps/PolarisMaps.entitlements`) and re-sign.

Until then, shared place links fall back to the `polaris-maps://` scheme and the
app still resolves them; only the https universal-link entry point is inactive.

## Submission path (iOS)

1. (Done) Policy/terms + landing/support are live at `app.polarismaps.app`.
2. Fill review contact info and capture screenshots.
3. `bundle exec fastlane ios release` → uploads the build to App Store Connect.
4. Complete App Privacy + listing metadata in App Store Connect (or run
   `fastlane deliver`).
5. Submit for App Review manually.
