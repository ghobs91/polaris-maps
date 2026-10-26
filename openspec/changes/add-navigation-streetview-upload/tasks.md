> **Implementation status (2026-10-26):** the capture/queue/summary flow and
> both Panoramax and Mapillary upload clients are implemented and covered by
> unit tests; `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, the full Jest
> suite, and an iOS production export pass. The Mapillary client now also
> refreshes on a mid-upload 401 (disconnecting the account if the refresh is
> rejected), backs off and retries 429/5xx failures, and submits one cluster per
> drive segment (1,000 images or a >10 min gap). The navigation screen shows the
> live camera in the bottom quarter of the screen with the driving HUD above it,
> and a rolling dash cam (segmented muted recording, time + size retention with
> automatic oldest-first pruning, playback and export) ships alongside it.
> Remaining: device spikes (camera geometry, ultra-wide lens, real-account
> uploads), the `react-native-vision-camera` migration that allows stills and
> video to run simultaneously, privacy/store copy, and release verification.

## 0. Spikes and decisions

- [ ] 0.1 Device spike (iOS + Android): capture a 1920×1080 JPEG from a 96×54
      16:9 `CameraView` with the app portrait-locked and the phone mounted
      portrait and landscape; record output dimensions, orientation, and EXIF
      (`GPSLatitude`, `GPSLongitude`, `GPSImgDirection`, `DateTimeOriginal`,
      `GPSTimeStamp`). Decide whether landscape output is reliable or whether
      Mapillary must be gated on landscape-mounted drives.
- [ ] 0.2 iOS lens spike: on an iPhone with an ultra-wide camera, call
      `getAvailableLensesAsync()`, record the returned identifiers, select the
      ultra-wide, and verify the output FOV and EXIF focal length. Decide
      whether a native selector is needed for localized lens names.
- [ ] 0.3 Mapillary spike: with a test account, exercise the embedded-secret
      OAuth exchange + refresh, then upload 5 properly tagged JPEGs via the raw
      upload service + manifest + `finish_upload`; verify processing appears in
      Mapillary and `compass_angle` is correct. Record the exact responses and
      any rate limits.
- [ ] 0.4 Panoramax spike: against a disposable/test instance, create an upload
      set, upload 5 JPEGs with overrides + `picture_id`, complete, and poll
      status; verify the collection and blur behavior.
- [ ] 0.5 Confirm the curated-instance picker shape from
      `https://api.panoramax.xyz/api/instances` (fields, search, empty/error
      states) and the first-run auto-start prompt copy.

## 1. Foundation: models, database, settings

- [ ] 1.1 Add `src/models/streetViewCapture.ts` with drive, capture, and upload
      batch types, per-target statuses, and capture configuration types.
- [ ] 1.2 Add `streetview_drives`, `streetview_captures`, and
      `streetview_uploads` tables + indexes to `src/services/database/init.ts`
      (additive `CREATE TABLE IF NOT EXISTS`; no destructive migration).
- [ ] 1.3 Add a repository/service for queue CRUD and per-file status
      transitions (`src/services/imagery/streetViewQueue.ts`), with tests for
      idempotent status updates and crash-resume queries.
- [ ] 1.4 Extend `settingsStore` with capture preferences (enabled, auto-start +
      first-prompt-answered, mode/lens, distance, Wi-Fi-only, auto-upload,
      storage cap) and non-secret account metadata (instance URL/username,
      Mapillary username). Keep tokens out of MMKV; use SecureStore keys.
- [ ] 1.5 Add unit tests for settings defaults, migration parsing, and
      SecureStore wrapper behavior.
- [ ] 1.6 Add the Settings → Street imagery section (toggles, mode/lens,
      density, storage used, pending drives, platform connection status)
      without wiring uploads yet.

## 2. Capture pipeline

- [ ] 2.1 Publish the raw GPS fix from `trackingService.processFix` to
      `navigationTrackingStore` (lat/lng, altitude, accuracy, heading, speed,
      fix timestamp); unit-test that snapped and raw values are both available.
- [ ] 2.2 Implement pure capture gating:
      `shouldCapture(previous, fix, config)` and `buildCaptureExif(fix, now)`
      with distance/speed/time/accuracy rules; unit tests for stopped, slow,
      fast, poor-accuracy, and camera-busy cases.
- [ ] 2.3 Implement `CaptureHost` in `app/_layout.tsx`: one `CameraView` with a
      16:9 preview, `pictureSize` by mode (1080p Standard / full-res 3D),
      `shutterSound: false`, `animateShutter: false`, `exif: true`, and
      `additionalExif`. Mount it only while a session is active.
- [ ] 2.4 Implement lens/mode selection: Standard = default wide lens; 3D =
      `getAvailableLensesAsync()` + `selectedLens` ultra-wide on iOS when
      available, wide fallback on Android; never use the `zoom` prop for 0.5×.
- [ ] 2.5 Implement session lifecycle: start/stop from the nav HUD, start on
      navigation start when auto-start is enabled, first-run auto-start prompt
      on the first driving route, finalize on `stopNavigation`/arrival,
      pause/resume on `AppState` changes.
- [ ] 2.6 Copy each captured file to
      `document/streetview/{driveId}/{captureId}.jpg`, insert the queue row,
      and update the indicator count/size. Do not run `expo-image-manipulator`
      over the file.
- [ ] 2.7 Add storage guards: free-disk check, queue-size cap, warning at 1 GB,
      hard stop at the configured cap.
- [ ] 2.8 Add the navigation HUD camera action + persistent recording/paused
      indicator with accessibility labels and a 44×44 pt touch target.
- [ ] 2.9 Device-test capture with map rendering, rerouting, tab switches, and
      CarPlay companion mode; record frame rate, battery, and thermal behavior.
- [ ] 2.10 Device-test 3D mode: verify the ultra-wide lens is actually used,
      the EXIF focal length reflects it, and storage/thermal behavior is
      acceptable.

## 3. End-of-drive summary and queue UX

- [ ] 3.1 Add `pendingDriveReview` state and a `DriveUploadSheet` mounted in the
      root layout; show count, MB, duration/distance, and platform targets.
- [ ] 3.2 Wire actions: Upload, Not now, Delete all; persist deferred drives and
      show them in Settings with a Retry/Upload action.
- [ ] 3.3 Add upload progress UI (per target, per-file count, current file), a
      cancel action, and a results summary with links/status.
- [ ] 3.4 Add integration tests for the transition
      navigation-end → summary → selected targets → queue rows; verify no upload
      occurs without confirmation and Delete all removes files/rows.

## 4. Panoramax upload

- [ ] 4.1 Implement `panoramaxClient` with injectable fetch/upload functions:
      instance validation, federated catalog fetch/search
      (`https://api.panoramax.xyz/api/instances`), upload-set create, multipart
      file upload with overrides + `picture_id`, complete, status/files polling,
      and token revoke.
- [ ] 4.2 Implement the connect flow: generate token, open claim URL with
      `expo-web-browser`, poll `/api/users/me`, store JWT + token id in
      SecureStore, surface username/instance; handle timeout/denied/unreachable
      cases.
- [ ] 4.3 Implement the upload orchestrator for Panoramax: resume an existing
      upload set, skip already-uploaded `picture_id`s, retry transient errors,
      complete once, poll status, store collection links.
- [ ] 4.4 Contract tests with a mock HTTP server/fetch: create → upload →
      complete → status, 401, 409 duplicate, 5xx/retry, partial resume.
- [ ] 4.5 Manual test against a disposable real instance: 5–20 photos, verify
      sequence order, headings, blur, and collection visibility; delete the
      test upload.
- [ ] 4.6 Add the Panoramax target UI: searchable curated instance picker,
      account connect, visibility, and disconnected/unauthorized states.

## 5. Mapillary upload

- [ ] 5.1 Implement the embedded-secret auth flow: OAuth authorize URL,
      custom-scheme callback, direct token exchange/refresh with the embedded
      client id/secret, account lookup (`/me`), SecureStore persistence,
      disconnect. Disable the target cleanly when the env vars are absent.
- [ ] 5.2 Implement `mapillaryClient`: raw JPEG upload with `Offset` and
      `X-Entity-Name`, manifest upload, `finish_upload`, error mapping, and
      token refresh.
- [ ] 5.3 Implement the upload orchestrator: sort by capture time, skip
      non-landscape captures with a reported reason, store file handles
      immediately, retry per file, create one cluster per drive segment, and
      record `cluster_id`.
- [ ] 5.4 Contract tests with mocked upload service/graph endpoints: happy
      path, 401 → refresh, 5xx/retry, crash between image upload and manifest,
      crash after finish, portrait exclusion.
- [ ] 5.5 Manual test with a test Mapillary account: 5–20 photos, verify EXIF,
      compass angle, processing status, and that faces/plates are blurred;
      delete the test upload.
- [ ] 5.6 Add the Mapillary target UI and the "not configured in this build"
      state; ensure the app is fully usable with Mapillary absent.

## 6. Privacy, settings, and store readiness

- [ ] 6.1 Add the first-use explainer (what is captured, recipients, public
      licence, server-side blur, no private spaces, stop control) and the
      one-time auto-start prompt; gate capture on acceptance.
- [ ] 6.2 Update `app.json` camera usage copy to cover voluntary street-imagery
      contribution; rebuild native projects.
- [ ] 6.3 Update the privacy policy and App Store privacy labels / Play data
      safety for photos + precise location shared with Mapillary and the chosen
      Panoramax instance.
- [ ] 6.4 Add the "do not interact with the phone while driving" copy and
      ensure the capture action is reachable before/after a drive, not only
      mid-drive.
- [ ] 6.5 Verify no tokens/coordinates/image bytes are logged; add a redaction
      test for the upload error paths.

## 7. Verification and rollout

- [ ] 7.1 Run `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, and the
      relevant unit/integration suites; report actual results (the repo has
      known pre-existing failures).
- [ ] 7.2 End-to-end device test: 20–30 minute drive in Standard mode, summary,
      upload to Panoramax, verify collection; repeat in 3D mode and with
      Mapillary.
- [ ] 7.3 Failure drills: airplane mode, app kill mid-upload, 401, low storage,
      locked phone, CarPlay, reroute.
- [ ] 7.4 Performance/battery pass on a mid-range Android device and an iPhone;
      tune preview size, cadence, quality, and 3D-mode limits.
- [ ] 7.5 Feature-flag rollout: Panoramax first; Mapillary in the same release
      only if the embedded OAuth flow passes the Phase 0 spike and a real upload.
- [ ] 7.6 Update `src/services/imagery/README.md`, `.env.example`
      (`EXPO_PUBLIC_MAPILLARY_CLIENT_ID`,
      `EXPO_PUBLIC_MAPILLARY_CLIENT_SECRET`), and release notes.
