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
| **`.com` → `.app` link decision**          | ⬜     | Place links + associated domains still use `polarismaps.com` (see below)  |

## Version

`app.json` → `expo.version` is the source of truth for the marketing version
(currently `0.1.0`). The shipped value lives in `ios/PolarisMaps/Info.plist`
(`CFBundleShortVersionString`), which is **hard-coded** — bumping `app.json`
alone will not change the binary. Run `npx expo prebuild` or update the plist,
then confirm with `bundle exec fastlane ios release` (the `verify_version_alignment`
preflight warns on drift).

## Known risk: `polarismaps.com` vs `polarismaps.app`

The canonical domain is `polarismaps.app`, but these still reference `.com`:

- `src/services/places/shareService.ts` → `PLACE_LINK_HOST = 'polarismaps.com'`
- `plugins/withUniversalLinks.js` → `applinks:polarismaps.com`

Universal links (`https://polarismaps.com/p/<id>`) will not open the app from the
`.app` domain, and Apple needs `apple-app-site-association` served at whichever
host is declared. Decide the final host, update both, and publish the AASA file
before relying on share links.

## Submission path (iOS)

1. Host the privacy policy and terms so both URLs resolve.
2. Fill review contact info and capture screenshots.
3. `bundle exec fastlane ios release` → uploads the build to App Store Connect.
4. Complete App Privacy + listing metadata in App Store Connect (or run
   `fastlane deliver`).
5. Submit for App Review manually.
