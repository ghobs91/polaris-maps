## Why

Polaris already has a standalone street-imagery capture screen and a P2P
`street_imagery` feed, but neither is usable during a drive: the capture screen
is a separate destination, the pipeline is P2P-only, and the blur step is a
placeholder. Meanwhile, Mapillary and Panoramax both accept crowd-sourced
street-level JPEGs and expose upload APIs. Adding an opt-in "capture while
navigating, upload at the end of the drive" flow turns every drive into map
coverage without asking the driver to open a second app.

This is a natural extension of the existing navigation product: the app already
runs a high-accuracy location pipeline for the whole trip, already has camera
permission, and already knows when a drive ends (`arrivalCoordinator` /
`stopNavigation`). The missing pieces are capture scheduling, EXIF-quality
metadata, a crash-safe local queue, an end-of-drive summary, and two upload
clients.

## What Changes

- Add an opt-in **Street Imagery** contribution mode that can run while
  turn-by-turn navigation is active. It captures 16:9 street-level JPEGs
  (landscape when the phone is mounted horizontally) on a distance/speed-gated
  cadence, writes GPS, heading, and capture-time EXIF, and stores them in a
  per-drive local queue.
- Host the camera in a small, always-visible 16:9 preview (not the navigation
  screen) so capture survives tab changes and CarPlay-companion navigation.
  Pause automatically whenever the app is not active; camera capture is not
  possible on a locked phone.
- Reuse the existing navigation GPS pipeline as the capture clock: publish the
  raw fix alongside the snapped navigation position and trigger captures from
  distance travelled, with a minimum time between shots and a minimum speed.
- Add an end-of-drive **Upload street imagery** sheet with a count/size
  summary, per-platform target selection, "Delete all", upload progress, retry,
  and deferred/Wi-Fi-only upload. MVP has no per-photo review grid.
- Add a **Panoramax upload client**: one upload set per drive, one multipart
  file per capture, GPS/time overrides plus a preassigned picture UUID, then
  `complete` and status polling. Panoramax needs no client secret and its token
  claim flow works from a mobile browser.
- Add a **Mapillary upload client**: user OAuth token with the `upload` scope,
  raw image upload to Mapillary's resumable upload service, a bundle manifest,
  and `finish_upload`. Mapillary requires landscape JPEGs with GPS and capture
  time in EXIF. Use a dedicated upload-scoped app registration with the client
  id/secret embedded at build time (decided; the security trade-off is recorded
  in D9).
- Add account/settings surfaces for connecting Panoramax (curated instance
  picker + token claim) and Mapillary (OAuth), capture density, capture mode,
  Wi-Fi-only upload, auto-upload, storage use, and disconnect/revoke.
- Add an optional **3D-friendly capture preset**: ultra-wide lens on supported
  iPhones, full-resolution stills, and denser ~8 m spacing, because overlap is
  the main thing that helps Mapillary's SfM/combined panning. Standard mode
  remains 1×/20 m. A single flat lens cannot reproduce Google-Street-View-grade
  3D; true 3D needs 360 or video capture.
- Keep the existing P2P `street_imagery` pipeline and the standalone
  `app/imagery/capture.tsx` screen unchanged. The new flow is a separate
  external-contribution path; P2P sharing remains its own opt-in.
- Do **not** use the existing placeholder `blurImage` for these uploads. It
  re-saves the image, strips metadata, and marks `blurred: true` without
  detecting anything. Mapillary blurs faces/plates server-side; Panoramax
  instances blur when the instance has a blur service enabled. The app must
  upload unblurred originals with `isBlurred: false` and state this accurately.

Out of scope for this change: 360°/equirectangular capture, video capture with
on-device frame extraction, true multi-view 3D reconstruction or a
Street-View-grade 3D viewer, ultra-wide lens selection on Android (not exposed
by `expo-camera`), background camera capture on a locked phone, Android
foreground-service camera work, per-photo review/deletion, and any change to
the P2P feed format.

## Capabilities

### New Capabilities

- `streetview-contribution`: Opt-in capture of street-level imagery during
  active navigation, its metadata and local queue, the end-of-drive summary and
  upload flow, and the Panoramax/Mapillary delivery clients with their account,
  privacy, storage, and retry rules.

### Modified Capabilities

None. Existing navigation, imagery-sharing, and street-view _viewer_ behaviour
is unchanged; the new mode only reads navigation state and writes new tables.

## Impact

- **New services**: capture session/controller and pure trigger/EXIF helpers,
  Panoramax client, Mapillary client, upload orchestrator, account/token
  storage (`src/services/imagery/`).
- **New stores/models**: `streetViewCaptureStore`, `streetViewUploadStore`,
  `src/models/streetViewCapture.ts`.
- **New UI**: global `CaptureHost` (preview + status), navigation HUD action to
  start/stop, first-run auto-start prompt, end-of-drive `DriveUploadSheet`
  (summary + Delete all), capture-mode/lens controls, settings section.
- **Modified**: `src/services/navigation/trackingService.ts` (publish the raw
  fix), `src/stores/navigationTrackingStore.ts`, `app/_layout.tsx` (mount the
  host/coordinator), `app/(tabs)/navigation.tsx` (capture action + indicator),
  `src/stores/settingsStore.ts` (capture/upload preferences), `src/components/
settings/SettingsContent.tsx`, `src/services/database/init.ts` (new tables).
- **Config**: `app.json` camera usage string should mention voluntary street
  imagery contribution; no new permission or background mode. A native rebuild
  is required after the copy change.
- **Dependencies**: none required for the core flow. `expo-camera`
  (`additionalExif`), `expo-file-system` (`uploadAsync`), `expo-secure-store`,
  `expo-web-browser`, and `@react-native-community/netinfo` are already
  installed. A pure-JS EXIF writer (e.g. `piexifjs`) is a contingency only if
  device testing shows `additionalExif` cannot write GPS on a target OS.
- **External setup**: a dedicated Mapillary OAuth application with `upload`
  scope and redirect URI `polaris-maps://mapillary-callback`; its client id and
  secret are embedded at build time (`EXPO_PUBLIC_MAPILLARY_CLIENT_ID`,
  `EXPO_PUBLIC_MAPILLARY_CLIENT_SECRET`). Also a Panoramax instance/account for
  each user who wants to upload; the instance is chosen from the federated
  catalog.
- **External secrets**: the Mapillary upload secret ships in the JS bundle and
  is extractable. Keep it separate from the read token, scope it to `upload`,
  never log it, and rotate it if abused. A token broker is the future upgrade
  path.
- **Privacy/store listings**: photos + precise location are shared with third
  parties. Privacy policy, App Store privacy labels, and Play data-safety
  disclosures must be updated before release.
- **Testing**: unit tests for trigger/EXIF/sequence/idempotency logic; contract
  tests for both clients against mocks; manual device tests for orientation,
  EXIF, camera+map performance, background pause, and real upload processing.
